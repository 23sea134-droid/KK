import { ref, set, get, onValue, off, push, query, orderByChild, limitToLast, startAt, endAt, remove, update } from 'firebase/database';
import { getFirebaseDatabase, getFirebaseAuth, ensureFirebaseInitialized } from './firebaseConfig';

// Store active listeners for cleanup
const activeListeners = new Map();

// Simplified authentication check - just verify current user exists
const validateCurrentUser = () => {
  const auth = getFirebaseAuth();
  const currentUser = auth.currentUser;
  
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }
  
  return currentUser;
};

// Generate listener key
const generateListenerKey = (type, userId, deviceId = null) => {
  return `${type}_${userId}${deviceId ? `_${deviceId}` : ''}`;
};

// Cleanup specific listener
const cleanupListener = (listenerKey) => {
  const listener = activeListeners.get(listenerKey);
  if (listener) {
    console.log(`Cleaning up listener: ${listenerKey}`);
    try {
      listener.cleanup();
    } catch (error) {
      console.error(`Error cleaning up listener ${listenerKey}:`, error);
    }
    activeListeners.delete(listenerKey);
  }
};

export const deviceService = {
  // Initialize device service
  initializeDeviceService: async () => {
    try {
      await ensureFirebaseInitialized();
      console.log('Device service initialized successfully');
      return true;
    } catch (error) {
      console.error('Device service initialization failed:', error);
      throw error;
    }
  },

  // Cleanup all listeners
  cleanupAllListeners: () => {
    console.log(`Cleaning up all device listeners (${activeListeners.size} active)`);
    
    activeListeners.forEach((listener, key) => {
      console.log(`Cleaning up listener: ${key}`);
      try {
        listener.cleanup();
      } catch (error) {
        console.error(`Error cleaning up listener ${key}:`, error);
      }
    });
    
    activeListeners.clear();
    console.log('All listeners cleaned up');
  },

  // Cleanup listeners for a specific user
  cleanupUserListeners: (userId) => {
    console.log(`Cleaning up all listeners for user: ${userId}`);
    const keysToRemove = [];
    
    activeListeners.forEach((listener, key) => {
      if (key.includes(userId)) {
        console.log(`Cleaning up user listener: ${key}`);
        try {
          listener.cleanup();
        } catch (error) {
          console.error(`Error cleaning up listener ${key}:`, error);
        }
        keysToRemove.push(key);
      }
    });
    
    keysToRemove.forEach(key => activeListeners.delete(key));
    console.log(`Cleaned up ${keysToRemove.length} listeners for user ${userId}`);
  },

  // Claim device ownership - CRITICAL FOR DIRECT AP SETUP
  claimDeviceOwnership: async (userId, deviceId) => {
    try {
      if (!userId || !deviceId) {
        return { success: false, error: 'User ID and device ID are required' };
      }

      const database = getFirebaseDatabase();
      const ownerRef = ref(database, `deviceOwners/${deviceId}`);
      
      // Check if device is already claimed
      const ownerSnapshot = await get(ownerRef);
      
      if (ownerSnapshot.exists()) {
        const currentOwner = ownerSnapshot.val();
        if (currentOwner !== userId) {
          return { 
            success: false, 
            error: 'Device is already claimed by another user' 
          };
        }
        // Already owned by this user
        console.log(`✓ Device ${deviceId} already owned by user ${userId}`);
        return { success: true, alreadyOwned: true };
      }
      
      // Claim the device
      await set(ownerRef, userId);
      console.log(`✅ Device ${deviceId} claimed by user ${userId}`);
      
      return { success: true };
    } catch (error) {
      console.error('Error claiming device ownership:', error);
      return { success: false, error: error.message };
    }
  },

  // Check device ownership - Used by Direct AP setup to verify permissions
  checkDeviceOwnership: async (deviceId) => {
    try {
      if (!deviceId) {
        return { success: false, isOwner: false, error: 'Device ID is required' };
      }

      const currentUser = validateCurrentUser();
      const userId = currentUser.uid;
      const database = getFirebaseDatabase();
      
      const ownerRef = ref(database, `deviceOwners/${deviceId}`);
      const ownerSnapshot = await get(ownerRef);
      
      const isOwner = ownerSnapshot.exists() && ownerSnapshot.val() === userId;
      
      console.log(`Device ${deviceId} ownership check: ${isOwner}`);
      return { success: true, isOwner, owner: ownerSnapshot.val() || null };
    } catch (error) {
      console.error('Error checking device ownership:', error);
      return { success: false, isOwner: false, error: error.message };
    }
  },

  // Add new device - WITH DUPLICATE PROTECTION AND OWNERSHIP CLAIM
  addDevice: async (userId, deviceData) => {
    try {
      if (!userId || !deviceData) {
        return { success: false, error: 'User ID and device data are required' };
      }

      const currentUser = validateCurrentUser();
      if (currentUser.uid !== userId) {
        return { success: false, error: 'User ID mismatch' };
      }

      const deviceId = deviceData.deviceId;
      if (!deviceId) {
        return { success: false, error: 'Device ID is required' };
      }

      // ✅ CHECK: Is device already claimed by someone else?
      const database = getFirebaseDatabase();
      const ownerRef = ref(database, `deviceOwners/${deviceId}`);
      const ownerSnap = await get(ownerRef);
      
      if (ownerSnap.exists()) {
        const currentOwner = ownerSnap.val();
        if (currentOwner !== userId) {
          return { 
            success: false, 
            error: 'This device is already claimed by another user',
            isDuplicate: true
          };
        }
        // Already owned by this user
        return { success: true, alreadyOwned: true };
      }

      // ✅ CLAIM DEVICE: Two simple writes
      // 1. Add to user's claimed devices list
      await set(ref(database, `users/${userId}/claimedDevices/${deviceId}`), true);
      
      // 2. Set device ownership
      await set(ownerRef, userId);
      
      console.log(`✅ Device ${deviceId} claimed by user ${userId}`);
      return { success: true, deviceId };
      
    } catch (error) {
      console.error('Error adding device:', error);
      return { success: false, error: error.message || 'Failed to add device' };
    }
  },

  // Get user devices - RETURNS PROPER RESPONSE OBJECT WITH OWNERSHIP CLAIM
  getUserDevices: async (userId) => {
    try {
      if (!userId) {
        console.error('getUserDevices: User ID is required');
        return { success: false, error: 'User ID is required', devices: [] };
      }

      const currentUser = validateCurrentUser();
      if (currentUser.uid !== userId) {
        return { success: false, error: 'Unauthorized: User ID mismatch', devices: [] };
      }
      
      const database = getFirebaseDatabase();
      
      // ✅ READ: Get list of claimed devices
      const claimedRef = ref(database, `users/${userId}/claimedDevices`);
      const claimedSnap = await get(claimedRef);
      
      if (!claimedSnap.exists()) {
        console.log(`getUserDevices: No claimed devices for user ${userId}`);
        return { success: true, devices: [] };
      }
      
      // ✅ FETCH: Get actual device data for each claimed device
      const deviceIds = Object.keys(claimedSnap.val());
      const devices = [];
      
      for (const deviceId of deviceIds) {
        try {
          // Ensure ownership is set
          await deviceService.claimDeviceOwnership(userId, deviceId);
          
          // Get device info
          const infoSnap = await get(ref(database, `devices/${deviceId}/info`));
          const infoData = infoSnap.exists() ? infoSnap.val() : {};
          
          // Get device data
          const dataSnap = await get(ref(database, `devices/${deviceId}/data`));
          const latestData = dataSnap.exists() ? dataSnap.val() : {};
          
          devices.push({
            id: deviceId,
            deviceId: deviceId,
            name: infoData.name || infoData.deviceName || 'Water Monitor',
            location: infoData.location || 'Not Set',
            status: infoData.status || latestData.status || 'offline',
            lastSeen: infoData.lastSeen || Date.now(),
            totalUsage: latestData.totalLitres || 0,
            totalLitres: latestData.totalLitres || 0,
            flowRate: latestData.flowRate || 0,
            valveState: latestData.valveState || 'UNKNOWN',
            batteryLevel: latestData.batteryPercentage || infoData.batteryPercentage || 0,
            signalStrength: infoData.wifiInfo?.rssi || 'unknown',
            data: latestData,
            info: infoData
          });
        } catch (error) {
          console.warn(`Could not fetch data for device ${deviceId}:`, error.message);
          // Add device with basic info even if data fetch fails
          devices.push({
            id: deviceId,
            deviceId: deviceId,
            name: 'Water Monitor',
            status: 'offline',
            totalUsage: 0
          });
        }
      }
      
      console.log(`getUserDevices: Retrieved ${devices.length} devices for user ${userId}`);
      return { success: true, devices };
      
    } catch (error) {
      console.error('getUserDevices: Error:', error);
      return { success: false, error: error.message || 'Failed to get user devices', devices: [] };
    }
  },

  // Listen to device status changes
  listenToDeviceStatus: (userId, callback, errorCallback = null) => {
    const listenerKey = generateListenerKey('devices', userId);
    
    try {
      if (!userId || !callback) {
        throw new Error('User ID and callback function are required');
      }
      
      // Cleanup any existing listener for this user first
      cleanupListener(listenerKey);
      
      console.log(`Setting up device status listener for user: ${userId}`);
      
      // Immediate validation
      try {
        const currentUser = validateCurrentUser();
        if (currentUser.uid !== userId) {
          throw new Error('User ID mismatch');
        }
      } catch (error) {
        console.error('Initial user validation failed:', error);
        if (errorCallback) {
          errorCallback(error);
        }
        return () => {};
      }
      
      const database = getFirebaseDatabase();
      const devicesRef = ref(database, `users/${userId}/devices`);
      
      console.log(`Starting Firebase listener for devices: ${userId}`);
      
      const handleValue = (snapshot) => {
        try {
          // Quick auth check in callback
          const auth = getFirebaseAuth();
          if (!auth.currentUser || auth.currentUser.uid !== userId) {
            console.log('User no longer authenticated, cleaning up device listener');
            cleanupListener(listenerKey);
            return;
          }

          if (snapshot.exists()) {
            const devices = [];
            snapshot.forEach((child) => {
              const deviceData = child.val();
              devices.push({ 
                id: child.key, 
                ...deviceData,
                status: deviceData.status || 'offline',
                batteryLevel: deviceData.batteryLevel || 0,
                signalStrength: deviceData.signalStrength || 'unknown',
                totalUsage: deviceData.totalUsage || 0
              });
            });
            
            console.log(`Device status update: ${devices.length} devices`);
            callback(devices);
          } else {
            console.log('No devices found, returning empty array');
            callback([]);
          }
        } catch (error) {
          console.error('Error processing device data:', error);
          if (errorCallback) {
            errorCallback(error);
          }
        }
      };

      const handleError = (error) => {
        console.error('Firebase devices listener error:', error);
        
        // Clean up the listener on error
        cleanupListener(listenerKey);
        
        if (errorCallback) {
          if (error.code === 'PERMISSION_DENIED' || error.message?.includes('permission_denied')) {
            const authError = new Error('Permission denied - please sign in again');
            authError.code = 'permission-denied';
            errorCallback(authError);
          } else {
            errorCallback(error);
          }
        }
      };
      
      // Set up the listener
      onValue(devicesRef, handleValue, handleError);
      
      // Store the listener for cleanup
      activeListeners.set(listenerKey, {
        cleanup: () => {
          try {
            console.log(`Unsubscribing devices listener: ${listenerKey}`);
            off(devicesRef, 'value', handleValue);
          } catch (error) {
            console.error('Error cleaning up device listener:', error);
          }
        },
        userId,
        type: 'devices'
      });
      
      console.log(`Device status listener established: ${listenerKey}`);
      
      // Return cleanup function
      return () => cleanupListener(listenerKey);
      
    } catch (error) {
      console.error('Error initializing device status listener:', error);
      if (errorCallback) {
        errorCallback(error);
      }
      return () => {};
    }
  },

  // Listen to device info changes (status, version, wifi, etc.) - NEW FOR DIRECT AP
  listenToDeviceInfo: (deviceId, callback, errorCallback = null) => {
    const currentUser = validateCurrentUser();
    const userId = currentUser.uid;
    const listenerKey = generateListenerKey('device_info', userId, deviceId);
    
    try {
      if (!deviceId || !callback) {
        throw new Error('Device ID and callback function are required');
      }
      
      // Cleanup any existing listener
      cleanupListener(listenerKey);
      
      console.log(`Setting up device info listener for device: ${deviceId}`);
      
      const database = getFirebaseDatabase();
      const infoRef = ref(database, `devices/${deviceId}/info`);
      
      const handleValue = (snapshot) => {
        try {
          // Quick auth check
          const auth = getFirebaseAuth();
          if (!auth.currentUser || auth.currentUser.uid !== userId) {
            console.log('User no longer authenticated, cleaning up device info listener');
            cleanupListener(listenerKey);
            return;
          }

          if (snapshot.exists()) {
            const info = snapshot.val();
            console.log(`Device info update for ${deviceId}:`, info.status);
            callback(info);
          } else {
            console.log('No device info available');
            callback(null);
          }
        } catch (error) {
          console.error('Error processing device info:', error);
          if (errorCallback) {
            errorCallback(error);
          }
        }
      };

      const handleError = (error) => {
        console.error('Firebase device info listener error:', error);
        
        // Clean up the listener on error
        cleanupListener(listenerKey);
        
        if (errorCallback) {
          if (error.code === 'PERMISSION_DENIED' || error.message?.includes('permission_denied')) {
            console.log(`Permission denied for device ${deviceId} - likely deleted`);
          }
          errorCallback(error);
        }
      };
      
      // Set up the listener
      onValue(infoRef, handleValue, handleError);
      
      // Store the listener for cleanup
      activeListeners.set(listenerKey, {
        cleanup: () => {
          try {
            console.log(`Unsubscribing device info listener: ${listenerKey}`);
            off(infoRef, 'value', handleValue);
          } catch (error) {
            console.error('Error cleaning up device info listener:', error);
          }
        },
        userId,
        deviceId,
        type: 'device_info'
      });
      
      console.log(`Device info listener established: ${listenerKey}`);
      
      // Return cleanup function
      return () => cleanupListener(listenerKey);
      
    } catch (error) {
      console.error('Error initializing device info listener:', error);
      if (errorCallback) {
        errorCallback(error);
      }
      return () => {};
    }
  },

  // Update device - CORRECTED VERSION (No undefined values)
  updateDevice: async (userId, deviceId, updates) => {
    try {
      if (!userId || !deviceId || !updates) {
        return { success: false, error: 'User ID, device ID, and updates are required' };
      }

      const currentUser = validateCurrentUser();
      if (currentUser.uid !== userId) {
        return { success: false, error: 'User ID mismatch' };
      }
      
      const database = getFirebaseDatabase();
      const deviceRef = ref(database, `users/${userId}/devices/${deviceId}`);
      
      // Check if device exists
      const currentSnapshot = await get(deviceRef);
      if (!currentSnapshot.exists()) {
        return { success: false, error: 'Device not found' };
      }
      
      // Create a clean update object with only non-undefined fields
      const cleanUpdate = {
        updatedAt: new Date().toISOString()
      };
      
      // Only add fields that have defined values
      if (updates.name !== undefined) cleanUpdate.name = updates.name;
      if (updates.location !== undefined) cleanUpdate.location = updates.location;
      if (updates.deviceId !== undefined) cleanUpdate.deviceId = updates.deviceId;
      
      // Don't include fields with undefined values
      // Remove fields like version, batteryLevel, etc. unless explicitly provided
      for (const key in updates) {
        if (updates[key] !== undefined && !cleanUpdate.hasOwnProperty(key)) {
          cleanUpdate[key] = updates[key];
        }
      }

      await update(deviceRef, cleanUpdate);
      
      console.log(`✅ Device updated successfully: ${deviceId}`, cleanUpdate);
      return { success: true };
    } catch (error) {
      console.error('Error updating device:', error);
      return { success: false, error: error.message || 'Failed to update device' };
    }
  },

  // Control device valve - USES devices/{deviceId}/commands
  controlValve: async (deviceId, shouldOpen) => {
    try {
      if (!deviceId || typeof shouldOpen !== 'boolean') {
        return { success: false, error: 'Device ID and valve state (boolean) are required' };
      }

      const currentUser = validateCurrentUser();
      const userId = currentUser.uid;
      const database = getFirebaseDatabase();
      
      // Verify device ownership
      const ownerRef = ref(database, `deviceOwners/${deviceId}`);
      const ownerSnapshot = await get(ownerRef);
      
      if (!ownerSnapshot.exists() || ownerSnapshot.val() !== userId) {
        return { success: false, error: 'You do not own this device' };
      }
      
      // Send command to devices/{deviceId}/commands/valveControl
      const commandRef = ref(database, `devices/${deviceId}/commands/valveControl`);
      await set(commandRef, shouldOpen);
      
      console.log(`✅ Valve control command sent: ${shouldOpen ? 'OPEN' : 'CLOSE'} for device ${deviceId}`);
      return { success: true };
    } catch (error) {
      console.error('Error controlling valve:', error);
      return { success: false, error: error.message || 'Failed to control valve' };
    }
  },

  // Reset total litres - Send command to device
  resetTotalLitres: async (deviceId) => {
    try {
      if (!deviceId) {
        return { success: false, error: 'Device ID is required' };
      }

      const currentUser = validateCurrentUser();
      const userId = currentUser.uid;
      const database = getFirebaseDatabase();
      
      // Verify device ownership
      const ownerRef = ref(database, `deviceOwners/${deviceId}`);
      const ownerSnapshot = await get(ownerRef);
      
      if (!ownerSnapshot.exists() || ownerSnapshot.val() !== userId) {
        return { success: false, error: 'You do not own this device' };
      }
      
      // Send command to devices/{deviceId}/commands/resetTotal
      const commandRef = ref(database, `devices/${deviceId}/commands/resetTotal`);
      await set(commandRef, true);
      
      console.log(`✅ Reset total command sent for device ${deviceId}`);
      return { success: true };
    } catch (error) {
      console.error('Error resetting total litres:', error);
      return { success: false, error: error.message || 'Failed to reset total litres' };
    }
  },

  // Remove device - WITH OWNERSHIP CLEANUP AND LISTENER CLEANUP
  removeDevice: async (userId, deviceId) => {
    try {
      if (!userId || !deviceId) {
        return { success: false, error: 'User ID and device ID are required' };
      }

      const currentUser = validateCurrentUser();
      if (currentUser.uid !== userId) {
        return { success: false, error: 'User ID mismatch' };
      }
      
      // ✅ STEP 1: Stop all listeners for this device FIRST
      console.log(`Stopping listeners for device ${deviceId}`);
      const deviceDataListenerKey = generateListenerKey('device_data', userId, deviceId);
      const deviceInfoListenerKey = generateListenerKey('device_info', userId, deviceId);
      
      cleanupListener(deviceDataListenerKey);
      cleanupListener(deviceInfoListenerKey);
      
      const database = getFirebaseDatabase();
      
      // ✅ STEP 2: Remove from claimed devices list
      const claimedRef = ref(database, `users/${userId}/claimedDevices/${deviceId}`);
      await remove(claimedRef);
      console.log(`✅ Device ${deviceId} removed from user's claimed list`);
      
      // ✅ STEP 3: Remove device ownership
      const ownerRef = ref(database, `deviceOwners/${deviceId}`);
      const ownerSnap = await get(ownerRef);
      
      if (ownerSnap.exists() && ownerSnap.val() === userId) {
        await remove(ownerRef);
        console.log(`✅ Removed ownership for device ${deviceId}`);
      }
      
      // ✅ STEP 4: Optional - Clean up device data (uncomment if you want to delete device data too)
      // await remove(ref(database, `devices/${deviceId}`));
      // await remove(ref(database, `history/${deviceId}`));
      // await remove(ref(database, `analytics/${deviceId}`));
      
      return { success: true };
      
    } catch (error) {
      console.error('Error removing device:', error);
      return { success: false, error: error.message || 'Failed to remove device' };
    }
  },

  // Delete device (alias)
  deleteDevice: async (userId, deviceId) => {
    return await deviceService.removeDevice(userId, deviceId);
  },

  // Get device history - READS FROM history/{deviceId} with proper ownership check
  getDeviceHistory: async (deviceId, timeRange = '24h') => {
    try {
      if (!deviceId) {
        return { success: false, error: 'Device ID is required', data: [] };
      }

      const currentUser = validateCurrentUser();
      const userId = currentUser.uid;
      const database = getFirebaseDatabase();
      
      // Verify device ownership
      const ownershipResult = await deviceService.checkDeviceOwnership(deviceId);
      
      if (!ownershipResult.success || !ownershipResult.isOwner) {
        console.log(`Device ${deviceId} not found for user ${userId}`);
        return { success: false, error: 'Device not found or unauthorized', data: [] };
      }
      
      const now = Date.now();
      let startTime;
      
      switch (timeRange) {
        case '1h':
          startTime = now - (60 * 60 * 1000);
          break;
        case '24h':
          startTime = now - (24 * 60 * 60 * 1000);
          break;
        case '7d':
          startTime = now - (7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          startTime = now - (30 * 24 * 60 * 60 * 1000);
          break;
        case '12m':
          startTime = now - (365 * 24 * 60 * 60 * 1000);
          break;
        default:
          startTime = now - (24 * 60 * 60 * 1000);
      }
      
      // Read from history/{deviceId} node
      const historyRef = ref(database, `history/${deviceId}`);
      const historyQuery = query(
        historyRef, 
        orderByChild('timestamp'),
        startAt(startTime),
        endAt(now)
      );
      
      const snapshot = await get(historyQuery);
      
      if (snapshot.exists()) {
        const historyData = [];
        snapshot.forEach((child) => {
          const data = child.val();
          const timestamp = typeof data.timestamp === 'number' 
            ? data.timestamp 
            : new Date(data.timestamp).getTime();
          
          historyData.push({ 
            id: child.key, 
            timestamp: timestamp,
            flowRate: parseFloat(data.flowRate) || 0,
            totalLitres: parseFloat(data.totalLitres) || 0,
            valveState: data.valveState || 'UNKNOWN',
          });
        });
        
        historyData.sort((a, b) => a.timestamp - b.timestamp);
        
        console.log(`Retrieved ${historyData.length} history data points for device ${deviceId}`);
        return { success: true, data: historyData };
      }
      
      console.log(`No history data found for device ${deviceId}`);
      return { success: true, data: [] };
    } catch (error) {
      console.error('Error getting device history:', error);
      return { success: false, error: error.message || 'Failed to get device history', data: [] };
    }
  },

  // Get analytics data - READS FROM analytics/{deviceId} node
  getAnalyticsData: async (deviceId, timeRange = '7d') => {
    try {
      if (!deviceId) {
        return { success: false, error: 'Device ID is required', data: [] };
      }

      const currentUser = validateCurrentUser();
      const userId = currentUser.uid;
      const database = getFirebaseDatabase();
      
      // Verify device ownership
      const ownershipResult = await deviceService.checkDeviceOwnership(deviceId);
      
      if (!ownershipResult.success || !ownershipResult.isOwner) {
        console.log(`Device ${deviceId} does not belong to user ${userId}`);
        return { success: false, error: 'Device not found or unauthorized', data: [] };
      }
      
      // Read from analytics/{deviceId} node
      const analyticsRef = ref(database, `analytics/${deviceId}`);
      const analyticsQuery = query(analyticsRef, orderByChild('date'), limitToLast(365));
      
      const snapshot = await get(analyticsQuery);
      
      if (snapshot.exists()) {
        const analyticsData = [];
        snapshot.forEach((child) => {
          const data = child.val();
          analyticsData.push({ 
            id: child.key,
            date: data.date,
            totalUsage: parseFloat(data.totalUsage) || 0,
            averageFlow: parseFloat(data.averageFlow) || 0,
            peakFlow: parseFloat(data.peakFlow) || 0,
            duration: parseFloat(data.duration) || 0,
          });
        });
        
        analyticsData.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        console.log(`Retrieved ${analyticsData.length} analytics data points for device ${deviceId}`);
        return { success: true, data: analyticsData };
      }
      
      console.log(`No analytics data found for device ${deviceId}`);
      return { success: true, data: [] };
    } catch (error) {
      console.error('Error getting analytics data:', error);
      return { success: false, error: error.message || 'Failed to get analytics data', data: [] };
    }
  },

  // Listen to real-time device data - READS FROM devices/{deviceId}/data
  listenToDeviceData: (deviceId, callback, errorCallback = null) => {
    const currentUser = validateCurrentUser();
    const userId = currentUser.uid;
    const listenerKey = generateListenerKey('device_data', userId, deviceId);
    
    try {
      if (!deviceId || !callback) {
        throw new Error('Device ID and callback function are required');
      }
      
      // Cleanup any existing listener
      cleanupListener(listenerKey);
      
      console.log(`Setting up device data listener for device: ${deviceId}`);
      
      const database = getFirebaseDatabase();
      
      // First verify ownership
      deviceService.checkDeviceOwnership(deviceId).then((result) => {
        if (!result.success || !result.isOwner) {
          console.warn('Device ownership verification failed:', result.error);
        }
      });
      
      const dataRef = ref(database, `devices/${deviceId}/data`);
      
      const handleValue = (snapshot) => {
        try {
          // Quick auth check
          const auth = getFirebaseAuth();
          if (!auth.currentUser || auth.currentUser.uid !== userId) {
            console.log('User no longer authenticated, cleaning up device data listener');
            cleanupListener(listenerKey);
            return;
          }

          if (snapshot.exists()) {
            const data = snapshot.val();
            const deviceData = {
              deviceId: data.deviceId || deviceId,
              flowRate: parseFloat(data.flowRate) || 0,
              totalLitres: parseFloat(data.totalLitres) || 0,
              valveState: data.valveState || 'UNKNOWN',
              status: data.status || 'offline',
              timestamp: data.timestamp || Date.now(),
              rssi: data.rssi || null,
            };
            
            console.log(`Device data update for ${deviceId}`);
            callback(deviceData);
          } else {
            console.log('No device data available');
            callback(null);
          }
        } catch (error) {
          console.error('Error processing device data:', error);
          if (errorCallback) {
            errorCallback(error);
          }
        }
      };

      const handleError = (error) => {
        console.error('Firebase device data listener error:', error);
        
        // Clean up the listener on error
        cleanupListener(listenerKey);
        
        if (errorCallback) {
          if (error.code === 'PERMISSION_DENIED' || error.message?.includes('permission_denied')) {
            // Device was likely deleted or permission was revoked
            console.log(`Permission denied for device ${deviceId} - likely deleted`);
            const authError = new Error('Device no longer accessible');
            authError.code = 'permission-denied';
            errorCallback(authError);
          } else {
            errorCallback(error);
          }
        }
      };
      
      // Set up the listener
      onValue(dataRef, handleValue, handleError);
      
      // Store the listener for cleanup
      activeListeners.set(listenerKey, {
        cleanup: () => {
          try {
            console.log(`Unsubscribing device data listener: ${listenerKey}`);
            off(dataRef, 'value', handleValue);
          } catch (error) {
            console.error('Error cleaning up device data listener:', error);
          }
        },
        userId,
        deviceId,
        type: 'device_data'
      });
      
      console.log(`Device data listener established: ${listenerKey}`);
      
      // Return cleanup function
      return () => cleanupListener(listenerKey);
      
    } catch (error) {
      console.error('Error initializing device data listener:', error);
      if (errorCallback) {
        errorCallback(error);
      }
      return () => {};
    }
  },

  // Get current device data - Single read from devices/{deviceId}/data
  getDeviceData: async (deviceId) => {
    try {
      if (!deviceId) {
        return { success: false, error: 'Device ID is required', data: null };
      }

      const currentUser = validateCurrentUser();
      const userId = currentUser.uid;
      const database = getFirebaseDatabase();
      
      // Verify device ownership
      const ownershipResult = await deviceService.checkDeviceOwnership(deviceId);
      
      if (!ownershipResult.success || !ownershipResult.isOwner) {
        return { success: false, error: 'Device not found or unauthorized', data: null };
      }
      
      // Read current data
      const dataRef = ref(database, `devices/${deviceId}/data`);
      const dataSnapshot = await get(dataRef);
      
      if (dataSnapshot.exists()) {
        const data = dataSnapshot.val();
        const deviceData = {
          deviceId: data.deviceId || deviceId,
          flowRate: parseFloat(data.flowRate) || 0,
          totalLitres: parseFloat(data.totalLitres) || 0,
          valveState: data.valveState || 'UNKNOWN',
          status: data.status || 'offline',
          timestamp: data.timestamp || Date.now(),
          rssi: data.rssi || null,
        };
        
        console.log(`Retrieved device data for ${deviceId}`);
        return { success: true, data: deviceData };
      }
      
      console.log(`No current data found for device ${deviceId}`);
      return { success: true, data: null };
    } catch (error) {
      console.error('Error getting device data:', error);
      return { success: false, error: error.message || 'Failed to get device data', data: null };
    }
  },

  // Get device info - Single read from devices/{deviceId}/info - NEW FOR DIRECT AP
  getDeviceInfo: async (deviceId) => {
    try {
      if (!deviceId) {
        return { success: false, error: 'Device ID is required', data: null };
      }

      const currentUser = validateCurrentUser();
      const userId = currentUser.uid;
      const database = getFirebaseDatabase();
      
      // Verify device ownership
      const ownershipResult = await deviceService.checkDeviceOwnership(deviceId);
      
      if (!ownershipResult.success || !ownershipResult.isOwner) {
        return { success: false, error: 'Device not found or unauthorized', data: null };
      }
      
      // Read device info
      const infoRef = ref(database, `devices/${deviceId}/info`);
      const infoSnapshot = await get(infoRef);
      
      if (infoSnapshot.exists()) {
        const info = infoSnapshot.val();
        console.log(`Retrieved device info for ${deviceId}`);
        return { success: true, data: info };
      }
      
      console.log(`No info found for device ${deviceId}`);
      return { success: true, data: null };
    } catch (error) {
      console.error('Error getting device info:', error);
      return { success: false, error: error.message || 'Failed to get device info', data: null };
    }
  },

  // Migrate existing devices - claims ownership for all user devices
  migrateExistingDevices: async (userId) => {
    try {
      if (!userId) {
        return { success: false, error: 'User ID is required' };
      }

      const currentUser = validateCurrentUser();
      if (currentUser.uid !== userId) {
        return { success: false, error: 'User ID mismatch' };
      }

      console.log(`Starting device ownership migration for user ${userId}`);
      
      const response = await deviceService.getUserDevices(userId);
      
      if (!response.success) {
        return { success: false, error: response.error };
      }

      const devices = response.devices || [];
      let claimedCount = 0;
      let alreadyOwnedCount = 0;
      let failedCount = 0;

      for (const device of devices) {
        if (device.deviceId) {
          const result = await deviceService.claimDeviceOwnership(userId, device.deviceId);
          if (result.success) {
            if (result.alreadyOwned) {
              alreadyOwnedCount++;
            } else {
              claimedCount++;
            }
          } else {
            failedCount++;
            console.error(`Failed to claim device ${device.deviceId}:`, result.error);
          }
        }
      }

      console.log(`Migration complete: ${claimedCount} claimed, ${alreadyOwnedCount} already owned, ${failedCount} failed`);
      
      return { 
        success: true, 
        claimed: claimedCount,
        alreadyOwned: alreadyOwnedCount,
        failed: failedCount,
        total: devices.length
      };
    } catch (error) {
      console.error('Error during device migration:', error);
      return { success: false, error: error.message || 'Migration failed' };
    }
  },

  // Remove device ownership (when user removes a device)
  removeDeviceOwnership: async (deviceId) => {
    try {
      if (!deviceId) {
        return { success: false, error: 'Device ID is required' };
      }

      const currentUser = validateCurrentUser();
      const userId = currentUser.uid;
      const database = getFirebaseDatabase();
      
      // Check if user owns the device
      const ownerRef = ref(database, `deviceOwners/${deviceId}`);
      const ownerSnapshot = await get(ownerRef);
      
      if (!ownerSnapshot.exists() || ownerSnapshot.val() !== userId) {
        return { success: false, error: 'You do not own this device' };
      }
      
      // Remove ownership
      await remove(ownerRef);
      
      console.log(`✅ Device ownership removed: ${deviceId}`);
      return { success: true };
    } catch (error) {
      console.error('Error removing device ownership:', error);
      return { success: false, error: error.message || 'Failed to remove device ownership' };
    }
  },

  // Test device connection
  testDeviceConnection: async (deviceId) => {
    try {
      if (!deviceId) {
        return { success: false, error: 'Device ID is required' };
      }

      const currentUser = validateCurrentUser();
      const userId = currentUser.uid;
      const database = getFirebaseDatabase();
      
      // Verify device ownership
      const ownerRef = ref(database, `deviceOwners/${deviceId}`);
      const ownerSnapshot = await get(ownerRef);
      
      if (!ownerSnapshot.exists() || ownerSnapshot.val() !== userId) {
        return { success: false, error: 'You do not own this device' };
      }
      
      // Check if device info exists
      const deviceInfoRef = ref(database, `devices/${deviceId}/info`);
      const infoSnapshot = await get(deviceInfoRef);
      
      // Check if device data exists
      const deviceDataRef = ref(database, `devices/${deviceId}/data`);
      const dataSnapshot = await get(deviceDataRef);
      
      if (infoSnapshot.exists() || dataSnapshot.exists()) {
        console.log(`✅ Device ${deviceId} is connected and responding`);
        return { 
          success: true, 
          info: infoSnapshot.exists() ? infoSnapshot.val() : null,
          data: dataSnapshot.exists() ? dataSnapshot.val() : null
        };
      } else {
        console.log(`⚠️ Device ${deviceId} exists but has no data`);
        return { success: false, error: 'Device is not sending data' };
      }
    } catch (error) {
      console.error('Error testing device connection:', error);
      return { success: false, error: error.message || 'Failed to test device connection' };
    }
  },

  // Get active listeners info
  getActiveListeners: () => {
    const listeners = [];
    activeListeners.forEach((listener, key) => {
      listeners.push({
        key,
        userId: listener.userId,
        deviceId: listener.deviceId || 'all',
        type: listener.type
      });
    });
    return listeners;
  },

  // Get listener status
  getListenerStatus: () => {
    return {
      totalListeners: activeListeners.size,
      listeners: Array.from(activeListeners.keys())
    };
  }
};