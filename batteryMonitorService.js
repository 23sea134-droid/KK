import { ref, onValue, get, set, off } from 'firebase/database';
import { getFirebaseDatabase } from './firebaseConfig';
import { alertService } from './alertService';

// Store active listeners
const activeBatteryListeners = new Map();

// Cooldown tracking to prevent spam (24 hours)
const BATTERY_ALERT_COOLDOWN = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const alertCooldowns = new Map();

export const batteryMonitorService = {
  // Start monitoring battery for a specific device
  monitorDeviceBattery: (userId, deviceId, deviceName) => {
    const listenerKey = `battery_${deviceId}`;
    
    try {
      // Cleanup any existing listener
      if (activeBatteryListeners.has(listenerKey)) {
        batteryMonitorService.stopMonitoring(deviceId);
      }

      console.log(`Starting battery monitor for device: ${deviceId}`);
      
      const database = getFirebaseDatabase();
      const deviceDataRef = ref(database, `devices/${deviceId}/data`);
      
      const handleBatteryUpdate = async (snapshot) => {
        try {
          if (!snapshot.exists()) return;
          
          const data = snapshot.val();
          const batteryLevel = data.batteryPercentage;
          
          if (batteryLevel === undefined || batteryLevel === null) {
            console.log(`No battery data for device ${deviceId}`);
            return;
          }

          console.log(`Battery level for ${deviceName}: ${batteryLevel}%`);

          // Check if battery is below 20%
          if (batteryLevel < 20) {
            await batteryMonitorService.handleLowBattery(
              userId, 
              deviceId, 
              deviceName, 
              batteryLevel
            );
          }
        } catch (error) {
          console.error('Error processing battery update:', error);
        }
      };

      // Set up the listener
      onValue(deviceDataRef, handleBatteryUpdate);
      
      // Store the listener
      activeBatteryListeners.set(listenerKey, {
        cleanup: () => {
          off(deviceDataRef, 'value', handleBatteryUpdate);
        },
        deviceId,
        userId
      });
      
      console.log(`Battery monitor active for: ${deviceName}`);
      
      return () => batteryMonitorService.stopMonitoring(deviceId);
      
    } catch (error) {
      console.error('Error setting up battery monitor:', error);
      return () => {};
    }
  },

  // Handle low battery detection
  handleLowBattery: async (userId, deviceId, deviceName, batteryLevel) => {
    try {
      const cooldownKey = `${deviceId}_battery`;
      const now = Date.now();
      
      // Check cooldown
      const lastAlert = alertCooldowns.get(cooldownKey);
      if (lastAlert && (now - lastAlert) < BATTERY_ALERT_COOLDOWN) {
        console.log(`Battery alert cooldown active for ${deviceName} (${batteryLevel}%)`);
        return { success: false, reason: 'cooldown_active' };
      }

      console.log(`🔋 Low battery detected: ${deviceName} at ${batteryLevel}%`);
      
      // Create the alert
      const result = await alertService.createLowBatteryAlert(
        userId,
        deviceId,
        deviceName,
        batteryLevel
      );

      if (result.success) {
        // Update cooldown
        alertCooldowns.set(cooldownKey, now);
        
        // Also update in Firebase for persistence
        const database = getFirebaseDatabase();
        const trackingRef = ref(database, `alertTracking/${deviceId}/batteryAlerts`);
        await set(trackingRef, {
          lastAlert: now,
          alertCount: (await get(trackingRef)).val()?.alertCount + 1 || 1,
          lastBatteryLevel: batteryLevel
        });
        
        console.log(`✅ Low battery alert created for ${deviceName}`);
      }

      return result;
    } catch (error) {
      console.error('Error handling low battery:', error);
      return { success: false, error: error.message };
    }
  },

  // Monitor all user devices
  monitorAllDevices: async (userId) => {
    try {
      console.log(`Starting battery monitoring for all devices of user: ${userId}`);
      
      const database = getFirebaseDatabase();
      const devicesRef = ref(database, `users/${userId}/devices`);
      const snapshot = await get(devicesRef);
      
      if (!snapshot.exists()) {
        console.log('No devices found for user');
        return { success: true, monitored: 0 };
      }

      let monitorCount = 0;
      snapshot.forEach((deviceSnapshot) => {
        const device = deviceSnapshot.val();
        if (device.deviceId && device.name) {
          batteryMonitorService.monitorDeviceBattery(
            userId,
            device.deviceId,
            device.name
          );
          monitorCount++;
        }
      });

      console.log(`Battery monitoring started for ${monitorCount} devices`);
      return { success: true, monitored: monitorCount };
      
    } catch (error) {
      console.error('Error monitoring all devices:', error);
      return { success: false, error: error.message, monitored: 0 };
    }
  },

  // Stop monitoring a specific device
  stopMonitoring: (deviceId) => {
    const listenerKey = `battery_${deviceId}`;
    const listener = activeBatteryListeners.get(listenerKey);
    
    if (listener) {
      console.log(`Stopping battery monitor for: ${deviceId}`);
      try {
        listener.cleanup();
      } catch (error) {
        console.error('Error cleaning up battery monitor:', error);
      }
      activeBatteryListeners.delete(listenerKey);
    }
  },

  // Stop all battery monitoring
  stopAllMonitoring: () => {
    console.log(`Stopping all battery monitors (${activeBatteryListeners.size} active)`);
    
    activeBatteryListeners.forEach((listener, key) => {
      try {
        listener.cleanup();
      } catch (error) {
        console.error(`Error cleaning up monitor ${key}:`, error);
      }
    });
    
    activeBatteryListeners.clear();
    alertCooldowns.clear();
    console.log('All battery monitors stopped');
  },

  // Get active monitors
  getActiveMonitors: () => {
    const monitors = [];
    activeBatteryListeners.forEach((listener, key) => {
      monitors.push({
        key,
        deviceId: listener.deviceId,
        userId: listener.userId
      });
    });
    return monitors;
  }
};