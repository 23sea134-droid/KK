// context/DeviceDataContext.js
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { getDatabase, ref, onValue, off } from 'firebase/database';
import { useAuth } from './AuthContext';

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
  
  const listenersRef = useRef({});
  const isMountedRef = useRef(true);
  const appStateRef = useRef(AppState.currentState);

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

  // Track alerts that have been triggered
  const alertTrackerRef = useRef({});

  // Setup real-time listeners for all user devices
  const setupDeviceListeners = useCallback(async () => {
    if (!user?.uid || !isMountedRef.current) {
      console.log('⚠️ Cannot setup listeners: no user or unmounted');
      return;
    }

    console.log('🔌 Setting up real-time device listeners for user:', user.uid);
    
    try {
      const db = getDatabase();
      
      // 1. Listen to user's device list
      const userDevicesRef = ref(db, `users/${user.uid}/devices`);
      const userDevicesUnsubscribe = onValue(
        userDevicesRef,
        async (snapshot) => {
          if (!isMountedRef.current) return;
          
          console.log('📱 User devices list updated');
          
          if (!snapshot.exists()) {
            console.log('No devices found for user');
            setDevices([]);
            setLoading(false);
            return;
          }

          const devicesData = snapshot.val();
          const devicesList = [];
          const deviceIds = [];

          // Process each device
          for (const [key, device] of Object.entries(devicesData)) {
            const deviceId = device.deviceId || key;
            deviceIds.push(deviceId);

            // Initial device data from user's list
            devicesList.push({
              id: key,
              deviceId: deviceId,
              name: device.name || 'Water Monitor',
              location: device.location || 'Main Supply',
              status: 'loading',
              ...device
            });

            // Setup real-time listener for THIS device's data
            if (!listenersRef.current[`device_${deviceId}`]) {
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

                    // 🔥 CHECK FOR LOW BATTERY ALERT (below 20%)
                    const batteryLevel = deviceData.batteryPercentage || 0;
                    const alertKey = `${deviceId}_battery`;
                    
                    if (batteryLevel < 20 && batteryLevel > 0) {
                      // Only alert once until battery goes above 25% (hysteresis)
                      if (!alertTrackerRef.current[alertKey] || alertTrackerRef.current[alertKey] > 25) {
                        console.log(`🔋 LOW BATTERY ALERT: Device ${deviceId} at ${batteryLevel}%`);
                        alertTrackerRef.current[alertKey] = batteryLevel;
                        
                        // Trigger low battery alert (you can show notification here)
                        if (window.alertService) {
                          window.alertService.createAlert(user.uid, {
                            type: 'low_battery',
                            deviceId: deviceId,
                            batteryLevel: batteryLevel
                          });
                        }
                      }
                    } else if (batteryLevel >= 25) {
                      // Reset alert tracker when battery recovers
                      delete alertTrackerRef.current[alertKey];
                    }

                    // 🔥 CHECK FOR LEAK ALERT (high flow rate when valve is closed)
                    const flowRate = deviceData.flowRate || 0;
                    const valveState = deviceData.valveState || 'UNKNOWN';
                    const leakAlertKey = `${deviceId}_leak`;
                    
                    // Leak detection: flow rate > 0.5 L/min when valve is closed
                    if (flowRate > 0.5 && valveState === 'CLOSED') {
                      if (!alertTrackerRef.current[leakAlertKey]) {
                        console.log(`💧 LEAK ALERT: Device ${deviceId} - Flow ${flowRate} L/min with valve CLOSED`);
                        alertTrackerRef.current[leakAlertKey] = Date.now();
                        
                        // Trigger leak alert
                        if (window.alertService) {
                          window.alertService.createAlert(user.uid, {
                            type: 'leak_detected',
                            deviceId: deviceId,
                            flowRate: flowRate,
                            valveState: valveState
                          });
                        }
                      }
                    } else {
                      // Reset leak alert when conditions return to normal
                      if (alertTrackerRef.current[leakAlertKey] && 
                          (flowRate <= 0.5 || valveState === 'OPEN')) {
                        console.log(`✅ Leak condition resolved for device ${deviceId}`);
                        delete alertTrackerRef.current[leakAlertKey];
                      }
                    }

                    setDevices(prevDevices => {
                      const updatedDevices = prevDevices.map(d => {
                        if (d.deviceId === deviceId) {
                          return {
                            ...d,
                            data: deviceData,
                            // 🔥 ALL REAL-TIME METRICS
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
                            // 🔥 ALERT FLAGS
                            hasLowBattery: batteryLevel < 20 && batteryLevel > 0,
                            hasLeak: flowRate > 0.5 && valveState === 'CLOSED',
                          };
                        }
                        return d;
                      });
                      
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
                      lastSeen: new Date(deviceInfo.lastSeen).toLocaleTimeString()
                    });

                    setDevices(prevDevices => {
                      const updatedDevices = prevDevices.map(d => {
                        if (d.deviceId === deviceId) {
                          return {
                            ...d,
                            info: deviceInfo,
                            status: actualStatus,
                            lastSeen: deviceInfo.lastSeen,
                            batteryPercentage: deviceInfo.batteryPercentage || d.batteryLevel,
                            lastInfoUpdate: Date.now()
                          };
                        }
                        return d;
                      });
                      
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
          }

          // Set initial devices list
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
            if (!deviceIds.includes(existingId)) {
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

      listenersRef.current.userDevices = userDevicesUnsubscribe;

    } catch (error) {
      console.error('Error setting up device listeners:', error);
      if (isMountedRef.current) {
        setError(error.message);
        setLoading(false);
      }
    }
  }, [user?.uid]);

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
    };
  }, [user?.uid, setupDeviceListeners, handleAppStateChange, cleanupAllListeners]);

  // Calculate total usage across all devices
  const totalUsage = devices.reduce((sum, device) => {
    return sum + (parseFloat(device.totalUsage) || parseFloat(device.totalLitres) || 0);
  }, 0);

  // 🔥 Calculate aggregate flow metrics across all devices
  const flowMetrics = devices.reduce((metrics, device) => {
    const flowRate = device.flowRate || 0;
    
    if (flowRate > 0) {
      metrics.activeDevices += 1;
      metrics.totalFlow += flowRate;
      metrics.peakFlow = Math.max(metrics.peakFlow, flowRate);
    }
    
    return metrics;
  }, { activeDevices: 0, totalFlow: 0, peakFlow: 0 });

  const averageFlow = flowMetrics.activeDevices > 0 
    ? flowMetrics.totalFlow / flowMetrics.activeDevices 
    : 0;

  // 🔥 Count devices with alerts
  const alertCounts = devices.reduce((counts, device) => {
    if (device.hasLowBattery) counts.lowBattery += 1;
    if (device.hasLeak) counts.leak += 1;
    if (device.status?.toLowerCase() === 'offline') counts.offline += 1;
    return counts;
  }, { lowBattery: 0, leak: 0, offline: 0 });

  // 🔥 Calculate total alerts
  const totalAlerts = alertCounts.lowBattery + alertCounts.leak + alertCounts.offline;

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

  const value = {
    devices,
    loading,
    error,
    totalUsage,
    lastUpdate,
    refreshDevices,
    getDeviceById,
    // 🔥 FLOW METRICS
    averageFlow,
    peakFlow: flowMetrics.peakFlow,
    activeDevices: flowMetrics.activeDevices,
    // 🔥 ALERT METRICS
    alertCounts,
    totalAlerts,
    hasActiveAlerts: totalAlerts > 0,
  };

  return (
    <DeviceDataContext.Provider value={value}>
      {children}
    </DeviceDataContext.Provider>
  );
};
