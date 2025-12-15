// context/DeviceDataContext.js
import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AppState } from 'react-native';
import { getDatabase, ref, onValue, off } from 'firebase/database';
import { useAuth } from './AuthContext';
import { alertService } from '../services/alertService';

const DeviceDataContext = createContext();

export const useDeviceData = () => {
  const context = useContext(DeviceDataContext);
  if (!context) {
    throw new Error('useDeviceData must be used within DeviceDataProvider');
  }
  return context;
};

export const DeviceDataProvider = ({ children }) => {
  const { user } = useAuth();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(Date.now());
  
  // Refs for cleanup and state management
  const listenersRef = useRef({});
  const isMountedRef = useRef(true);
  const appStateRef = useRef(AppState.currentState);
  const alertTrackerRef = useRef({});
  const updateDebounceRef = useRef(null);

  // Cleanup all listeners
  const cleanupAllListeners = useCallback(() => {
    console.log('🧹 Cleaning up all device listeners');
    Object.entries(listenersRef.current).forEach(([key, unsubscribe]) => {
      if (typeof unsubscribe === 'function') {
        try {
          unsubscribe();
        } catch (error) {
          console.error(`Error cleaning up listener ${key}:`, error);
        }
      }
    });
    listenersRef.current = {};
  }, []);

  // Debounced update function to prevent rapid re-renders
  const debouncedUpdateDevices = useCallback((updatedDevices) => {
    if (updateDebounceRef.current) {
      clearTimeout(updateDebounceRef.current);
    }
    
    updateDebounceRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setDevices(updatedDevices);
        setLastUpdate(Date.now());
      }
    }, 100); // 100ms debounce
  }, []);

  // Handle leak detection
  const handleLeakDetection = useCallback(async (device) => {
    if (!device || !user?.uid) return;

    const flowRate = device.flowRate || 0;
    const valveState = device.valveState || 'UNKNOWN';
    const leakAlertKey = `${device.deviceId}_leak`;
    
    // Leak detection: flow rate > 0.5 L/min when valve is closed
    if (flowRate > 0.5 && valveState === 'CLOSED') {
      if (!alertTrackerRef.current[leakAlertKey]) {
        console.log(`💧 LEAK ALERT: Device ${device.deviceId} - Flow ${flowRate} L/min with valve CLOSED`);
        alertTrackerRef.current[leakAlertKey] = Date.now();
        
        // Create leak alert
        try {
          await alertService.createLeakAlert(
            user.uid,
            device.deviceId,
            device.name,
            flowRate,
            0 // duration in minutes - can be calculated if needed
          );
        } catch (error) {
          console.error('Error creating leak alert:', error);
        }
      }
    } else {
      // Reset leak alert when conditions return to normal
      if (alertTrackerRef.current[leakAlertKey] && 
          (flowRate <= 0.5 || valveState === 'OPEN')) {
        console.log(`✅ Leak condition resolved for device ${device.deviceId}`);
        delete alertTrackerRef.current[leakAlertKey];
      }
    }
  }, [user?.uid]);

  // Handle low battery detection
  const handleLowBatteryDetection = useCallback(async (device) => {
    if (!device || !user?.uid) return;

    const batteryLevel = device.batteryPercentage || 0;
    const alertKey = `${device.deviceId}_battery`;
    
    if (batteryLevel < 20 && batteryLevel > 0) {
      // Only alert once until battery goes above 25% (hysteresis)
      if (!alertTrackerRef.current[alertKey] || alertTrackerRef.current[alertKey] > 25) {
        console.log(`🔋 LOW BATTERY ALERT: Device ${device.deviceId} at ${batteryLevel}%`);
        alertTrackerRef.current[alertKey] = batteryLevel;
        
        // Create low battery alert
        try {
          await alertService.createLowBatteryAlert(
            user.uid,
            device.deviceId,
            device.name,
            batteryLevel
          );
        } catch (error) {
          console.error('Error creating low battery alert:', error);
        }
      }
    } else if (batteryLevel >= 25) {
      // Reset alert tracker when battery recovers
      delete alertTrackerRef.current[alertKey];
    }
  }, [user?.uid]);

  // Setup real-time listeners for all user devices
  const setupDeviceListeners = useCallback(async () => {
    if (!user?.uid || !isMountedRef.current) {
      console.log('⚠️ Cannot setup listeners: no user or unmounted');
      return;
    }

    console.log('🔌 Setting up real-time device listeners for user:', user.uid);
    
    try {
      const db = getDatabase();
      
      // Listen to user's device list (claimedDevices)
      const claimedDevicesRef = ref(db, `users/${user.uid}/claimedDevices`);
      const claimedDevicesUnsubscribe = onValue(
        claimedDevicesRef,
        async (snapshot) => {
          if (!isMountedRef.current) return;
          
          console.log('📱 User claimed devices list updated');
          
          if (!snapshot.exists()) {
            console.log('No devices found for user');
            setDevices([]);
            setLoading(false);
            return;
          }

          const claimedDeviceIds = Object.keys(snapshot.val());
          const devicesList = [];

          // Process each claimed device
          for (const deviceId of claimedDeviceIds) {
            // Setup real-time listener for THIS device's data
            if (!listenersRef.current[`device_${deviceId}_data`]) {
              const deviceDataRef = ref(db, `devices/${deviceId}/data`);
              const deviceInfoRef = ref(db, `devices/${deviceId}/info`);

              // Listen to device data (real-time sensor readings)
              const dataUnsubscribe = onValue(
                deviceDataRef,
                (dataSnapshot) => {
                  if (!isMountedRef.current) return;
                  
                  if (dataSnapshot.exists()) {
                    const deviceData = dataSnapshot.val();
                    
                    console.log(`📊 Device ${deviceId} data updated:`, {
                      flowRate: deviceData.flowRate,
                      totalLitres: deviceData.totalLitres,
                      valveState: deviceData.valveState,
                      batteryPercentage: deviceData.batteryPercentage
                    });

                    // Update devices state
                    setDevices(prevDevices => {
                      const updatedDevices = prevDevices.map(d => {
                        if (d.deviceId === deviceId) {
                          const updated = {
                            ...d,
                            data: deviceData,
                            flowRate: deviceData.flowRate || 0,
                            totalUsage: deviceData.totalLitres || d.totalUsage || 0,
                            totalLitres: deviceData.totalLitres || 0,
                            valveState: deviceData.valveState || 'UNKNOWN',
                            valveStatus: deviceData.valveState === 'OPEN' ? 'open' : 'closed',
                            batteryLevel: deviceData.batteryPercentage || 0,
                            batteryPercentage: deviceData.batteryPercentage || 0,
                            status: deviceData.status || d.status,
                            rssi: deviceData.rssi || d.rssi,
                            alertFlag: deviceData.alertFlag || false,
                            timestamp: deviceData.timestamp || Date.now(),
                            lastDataUpdate: Date.now(),
                          };

                          // Check for alerts
                          handleLeakDetection(updated);
                          handleLowBatteryDetection(updated);

                          return updated;
                        }
                        return d;
                      });
                      
                      // If device doesn't exist yet, add it
                      const deviceExists = updatedDevices.some(d => d.deviceId === deviceId);
                      if (!deviceExists) {
                        updatedDevices.push({
                          id: deviceId,
                          deviceId: deviceId,
                          name: 'Water Monitor',
                          location: 'Main Supply',
                          status: 'loading',
                          data: deviceData,
                          flowRate: deviceData.flowRate || 0,
                          totalUsage: deviceData.totalLitres || 0,
                          totalLitres: deviceData.totalLitres || 0,
                          valveState: deviceData.valveState || 'UNKNOWN',
                          valveStatus: deviceData.valveState === 'OPEN' ? 'open' : 'closed',
                          batteryLevel: deviceData.batteryPercentage || 0,
                          batteryPercentage: deviceData.batteryPercentage || 0,
                          lastDataUpdate: Date.now(),
                        });
                      }
                      
                      setLastUpdate(Date.now());
                      return updatedDevices;
                    });
                  }
                },
                (error) => {
                  console.error(`Error listening to device ${deviceId} data:`, error);
                }
              );

              // Listen to device info (status, metadata)
              const infoUnsubscribe = onValue(
                deviceInfoRef,
                (infoSnapshot) => {
                  if (!isMountedRef.current) return;
                  
                  if (infoSnapshot.exists()) {
                    const deviceInfo = infoSnapshot.val();
                    
                    // Determine actual status based on lastSeen
                    let actualStatus = deviceInfo.status || 'offline';
                    if (deviceInfo.lastSeen) {
                      const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
                      if (deviceInfo.lastSeen < fiveMinutesAgo && actualStatus === 'online') {
                        actualStatus = 'offline';
                      }
                    }

                    console.log(`ℹ️ Device ${deviceId} info updated:`, {
                      status: actualStatus,
                      name: deviceInfo.name,
                      lastSeen: new Date(deviceInfo.lastSeen).toLocaleTimeString()
                    });

                    setDevices(prevDevices => {
                      const updatedDevices = prevDevices.map(d => {
                        if (d.deviceId === deviceId) {
                          return {
                            ...d,
                            info: deviceInfo,
                            name: deviceInfo.name || deviceInfo.deviceName || d.name,
                            location: deviceInfo.location || d.location,
                            status: actualStatus,
                            lastSeen: deviceInfo.lastSeen,
                            batteryPercentage: deviceInfo.batteryPercentage || d.batteryLevel,
                            lastInfoUpdate: Date.now()
                          };
                        }
                        return d;
                      });
                      
                      // If device doesn't exist yet, add it with info
                      const deviceExists = updatedDevices.some(d => d.deviceId === deviceId);
                      if (!deviceExists) {
                        updatedDevices.push({
                          id: deviceId,
                          deviceId: deviceId,
                          name: deviceInfo.name || deviceInfo.deviceName || 'Water Monitor',
                          location: deviceInfo.location || 'Main Supply',
                          status: actualStatus,
                          info: deviceInfo,
                          lastSeen: deviceInfo.lastSeen,
                          batteryLevel: deviceInfo.batteryPercentage || 0,
                          batteryPercentage: deviceInfo.batteryPercentage || 0,
                          lastInfoUpdate: Date.now(),
                        });
                      }
                      
                      setLastUpdate(Date.now());
                      return updatedDevices;
                    });
                  }
                },
                (error) => {
                  console.error(`Error listening to device ${deviceId} info:`, error);
                }
              );

              // Store unsubscribe functions
              listenersRef.current[`device_${deviceId}_data`] = dataUnsubscribe;
              listenersRef.current[`device_${deviceId}_info`] = infoUnsubscribe;
            }

            // Add to initial devices list if not already there
            devicesList.push({
              id: deviceId,
              deviceId: deviceId,
              name: 'Water Monitor',
              location: 'Main Supply',
              status: 'loading',
              totalUsage: 0,
            });
          }

          // Set initial devices list (will be enriched by listeners)
          if (isMountedRef.current) {
            setDevices(prevDevices => {
              // Merge with existing data to keep real-time updates
              return devicesList.map(newDevice => {
                const existingDevice = prevDevices.find(d => d.deviceId === newDevice.deviceId);
                return existingDevice ? { ...newDevice, ...existingDevice } : newDevice;
              });
            });
            setLoading(false);
          }

          // Cleanup listeners for removed devices
          const currentDeviceIds = Object.keys(listenersRef.current)
            .filter(key => key.startsWith('device_'))
            .map(key => key.split('_')[1]);
          
          currentDeviceIds.forEach(existingId => {
            if (!claimedDeviceIds.includes(existingId)) {
              console.log(`🗑️ Removing listeners for deleted device: ${existingId}`);
              if (listenersRef.current[`device_${existingId}_data`]) {
                listenersRef.current[`device_${existingId}_data`]();
                delete listenersRef.current[`device_${existingId}_data`];
              }
              if (listenersRef.current[`device_${existingId}_info`]) {
                listenersRef.current[`device_${existingId}_info`]();
                delete listenersRef.current[`device_${existingId}_info`];
              }
            }
          });
        },
        (error) => {
          console.error('Error listening to user devices:', error);
          if (isMountedRef.current) {
            setError(error.message);
            setLoading(false);
          }
        }
      );

      listenersRef.current.claimedDevices = claimedDevicesUnsubscribe;

    } catch (error) {
      console.error('Error setting up device listeners:', error);
      if (isMountedRef.current) {
        setError(error.message);
        setLoading(false);
      }
    }
  }, [user?.uid, handleLeakDetection, handleLowBatteryDetection]);

  // Start battery monitoring for all devices
  // Handle app state changes
  const handleAppStateChange = useCallback((nextAppState) => {
    if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
      console.log('📱 App resumed - reconnecting listeners');
      if (user?.uid) {
        cleanupAllListeners();
        setupDeviceListeners();
      }
    } else if (nextAppState.match(/inactive|background/)) {
      console.log('📱 App backgrounded - keeping listeners active');
      // Keep listeners active in background for real-time updates
    }
    appStateRef.current = nextAppState;
  }, [user?.uid, cleanupAllListeners, setupDeviceListeners]);

  // Initialize listeners on mount
  useEffect(() => {
    isMountedRef.current = true;
    
    if (user?.uid) {
      setupDeviceListeners();
    } else {
      setLoading(false);
      setDevices([]);
    }

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      isMountedRef.current = false;
      cleanupAllListeners();
      subscription?.remove();
      
      // Clear debounce timer
      if (updateDebounceRef.current) {
        clearTimeout(updateDebounceRef.current);
      }
    };
  }, [user?.uid, setupDeviceListeners, handleAppStateChange, cleanupAllListeners]);

  // Calculate total usage across all devices
  const totalUsage = useMemo(() => {
    return devices.reduce((sum, device) => {
      return sum + (parseFloat(device.totalUsage) || parseFloat(device.totalLitres) || 0);
    }, 0);
  }, [devices]);

  // Calculate aggregate flow metrics across all devices
  const flowMetrics = useMemo(() => {
    return devices.reduce((metrics, device) => {
      const flowRate = device.flowRate || 0;
      
      if (flowRate > 0) {
        metrics.activeDevices += 1;
        metrics.totalFlow += flowRate;
        metrics.peakFlow = Math.max(metrics.peakFlow, flowRate);
      }
      
      return metrics;
    }, { activeDevices: 0, totalFlow: 0, peakFlow: 0 });
  }, [devices]);

  const averageFlow = useMemo(() => {
    return flowMetrics.activeDevices > 0 
      ? flowMetrics.totalFlow / flowMetrics.activeDevices 
      : 0;
  }, [flowMetrics]);

  // Count devices with alerts
  const alertCounts = useMemo(() => {
    return devices.reduce((counts, device) => {
      const batteryLevel = device.batteryPercentage || device.batteryLevel || 0;
      const flowRate = device.flowRate || 0;
      const valveState = device.valveState || 'UNKNOWN';
      const status = device.status?.toLowerCase() || 'unknown';
      
      if (batteryLevel < 20 && batteryLevel > 0) counts.lowBattery += 1;
      if (flowRate > 0.5 && valveState === 'CLOSED') counts.leak += 1;
      if (status === 'offline') counts.offline += 1;
      
      return counts;
    }, { lowBattery: 0, leak: 0, offline: 0 });
  }, [devices]);

  // Calculate total alerts
  const totalAlerts = useMemo(() => {
    return alertCounts.lowBattery + alertCounts.leak + alertCounts.offline;
  }, [alertCounts]);

  // Refresh function for manual refresh
  const refreshDevices = useCallback(async () => {
    console.log('🔄 Manual refresh triggered');
    cleanupAllListeners();
    await setupDeviceListeners();
  }, [cleanupAllListeners, setupDeviceListeners]);

  // Get device by ID
  const getDeviceById = useCallback((deviceId) => {
    return devices.find(d => d.deviceId === deviceId || d.id === deviceId);
  }, [devices]);

  // Get devices by status
  const getDevicesByStatus = useCallback((status) => {
    return devices.filter(d => d.status?.toLowerCase() === status.toLowerCase());
  }, [devices]);

  // Get online devices count
  const onlineDevicesCount = useMemo(() => {
    return devices.filter(d => d.status?.toLowerCase() === 'online').length;
  }, [devices]);

  // Get offline devices count
  const offlineDevicesCount = useMemo(() => {
    return devices.filter(d => d.status?.toLowerCase() === 'offline').length;
  }, [devices]);

  // Context value with memoization
  const value = useMemo(() => ({
    // Device data
    devices,
    loading,
    error,
    lastUpdate,
    
    // Aggregate metrics
    totalUsage,
    averageFlow,
    peakFlow: flowMetrics.peakFlow,
    activeDevices: flowMetrics.activeDevices,
    
    // Device counts
    totalDevices: devices.length,
    onlineDevicesCount,
    offlineDevicesCount,
    
    // Alert metrics
    alertCounts,
    totalAlerts,
    hasActiveAlerts: totalAlerts > 0,
    
    // Helper functions
    refreshDevices,
    getDeviceById,
    getDevicesByStatus,
  }), [
    devices,
    loading,
    error,
    lastUpdate,
    totalUsage,
    averageFlow,
    flowMetrics.peakFlow,
    flowMetrics.activeDevices,
    onlineDevicesCount,
    offlineDevicesCount,
    alertCounts,
    totalAlerts,
    refreshDevices,
    getDeviceById,
    getDevicesByStatus,
  ]);

  return (
    <DeviceDataContext.Provider value={value}>
      {children}
    </DeviceDataContext.Provider>
  );
};


