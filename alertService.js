import { ref, set, get, onValue, off, push, query, orderByChild, limitToLast, update, remove } from 'firebase/database';
import { getFirebaseDatabase, getFirebaseAuth, ensureFirebaseInitialized } from './firebaseConfig';

// Store active listeners for cleanup
const activeAlertListeners = new Map();

// Generate listener key
const generateAlertListenerKey = (type, userId) => {
  return `${type}_${userId}`;
};

// Cleanup specific listener
const cleanupAlertListener = (listenerKey) => {
  const listener = activeAlertListeners.get(listenerKey);
  if (listener) {
    console.log(`Cleaning up alert listener: ${listenerKey}`);
    try {
      listener.cleanup();
    } catch (error) {
      console.error(`Error cleaning up alert listener ${listenerKey}:`, error);
    }
    activeAlertListeners.delete(listenerKey);
  }
};

export const alertService = {
  // Create a new alert
  createAlert: async (userId, alertData) => {
    try {
      if (!userId || !alertData) {
        return { success: false, error: 'User ID and alert data are required' };
      }

      const database = getFirebaseDatabase();
      const alertRef = push(ref(database, `alerts/${userId}`));
      
      const alert = {
        id: alertRef.key,
        userId,
        type: alertData.type || 'system',
        title: alertData.title || '',
        message: alertData.message || '',
        deviceId: alertData.deviceId || null,
        deviceName: alertData.deviceName || null,
        read: false,
        createdAt: new Date().toISOString(),
        data: alertData.data || {}
      };
      
      await set(alertRef, alert);
      
      console.log(`✅ Alert created: ${alert.id} for user ${userId}`);
      return { success: true, alert };
    } catch (error) {
      console.error('Error creating alert:', error);
      return { success: false, error: error.message || 'Failed to create alert' };
    }
  },

  // Get user alerts
  getUserAlerts: async (userId, limit = 50) => {
    try {
      if (!userId) {
        return { success: false, error: 'User ID is required', alerts: [] };
      }

      const database = getFirebaseDatabase();
      const alertsRef = ref(database, `alerts/${userId}`);
      const alertsQuery = query(alertsRef, orderByChild('createdAt'), limitToLast(limit));
      
      const snapshot = await get(alertsQuery);
      
      if (snapshot.exists()) {
        const alerts = [];
        snapshot.forEach((child) => {
          alerts.push({
            id: child.key,
            ...child.val()
          });
        });
        
        // Sort by date (newest first)
        alerts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        console.log(`Retrieved ${alerts.length} alerts for user ${userId}`);
        return { success: true, alerts };
      }
      
      console.log(`No alerts found for user ${userId}`);
      return { success: true, alerts: [] };
    } catch (error) {
      console.error('Error getting user alerts:', error);
      return { success: false, error: error.message || 'Failed to get alerts', alerts: [] };
    }
  },

  // Mark alert as read
  markAlertAsRead: async (alertId) => {
    try {
      if (!alertId) {
        return { success: false, error: 'Alert ID is required' };
      }

      // First find which user this alert belongs to
      const database = getFirebaseDatabase();
      const alertRef = ref(database, `alerts`);
      const snapshot = await get(alertRef);
      
      let userId = null;
      let alertPath = null;
      
      snapshot.forEach((userChild) => {
        userChild.forEach((alertChild) => {
          if (alertChild.key === alertId) {
            userId = userChild.key;
            alertPath = `alerts/${userId}/${alertId}`;
          }
        });
      });
      
      if (!userId || !alertPath) {
        return { success: false, error: 'Alert not found' };
      }

      // Update alert
      const updateData = {
        read: true,
        readAt: new Date().toISOString()
      };
      
      await update(ref(database, alertPath), updateData);
      
      console.log(`✅ Alert marked as read: ${alertId}`);
      return { success: true };
    } catch (error) {
      console.error('Error marking alert as read:', error);
      return { success: false, error: error.message || 'Failed to mark alert as read' };
    }
  },

  // Delete alert
  deleteAlert: async (alertId) => {
    try {
      if (!alertId) {
        return { success: false, error: 'Alert ID is required' };
      }

      // First find which user this alert belongs to
      const database = getFirebaseDatabase();
      const alertRef = ref(database, `alerts`);
      const snapshot = await get(alertRef);
      
      let userId = null;
      let alertPath = null;
      
      snapshot.forEach((userChild) => {
        userChild.forEach((alertChild) => {
          if (alertChild.key === alertId) {
            userId = userChild.key;
            alertPath = `alerts/${userId}/${alertId}`;
          }
        });
      });
      
      if (!userId || !alertPath) {
        return { success: false, error: 'Alert not found' };
      }

      // Delete alert
      await remove(ref(database, alertPath));
      
      console.log(`✅ Alert deleted: ${alertId}`);
      return { success: true };
    } catch (error) {
      console.error('Error deleting alert:', error);
      return { success: false, error: error.message || 'Failed to delete alert' };
    }
  },

  // Listen to user alerts
  listenToUserAlerts: (userId, callback, errorCallback = null) => {
    const listenerKey = generateAlertListenerKey('alerts', userId);
    
    try {
      if (!userId || !callback) {
        throw new Error('User ID and callback function are required');
      }
      
      // Cleanup any existing listener for this user first
      cleanupAlertListener(listenerKey);
      
      console.log(`Setting up alerts listener for user: ${userId}`);
      
      const database = getFirebaseDatabase();
      const alertsRef = ref(database, `alerts/${userId}`);
      const alertsQuery = query(alertsRef, orderByChild('createdAt'), limitToLast(50));
      
      console.log(`Starting Firebase listener for alerts: ${userId}`);
      
      const handleValue = (snapshot) => {
        try {
          // Quick auth check
          const auth = getFirebaseAuth();
          if (!auth.currentUser || auth.currentUser.uid !== userId) {
            console.log('User no longer authenticated, cleaning up alerts listener');
            cleanupAlertListener(listenerKey);
            return;
          }

          if (snapshot.exists()) {
            const alerts = [];
            snapshot.forEach((child) => {
              alerts.push({
                id: child.key,
                ...child.val()
              });
            });
            
            // Sort by date (newest first)
            alerts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            
            console.log(`Alerts update: ${alerts.length} alerts`);
            callback(alerts);
          } else {
            console.log('No alerts found');
            callback([]);
          }
        } catch (error) {
          console.error('Error processing alerts data:', error);
          if (errorCallback) {
            errorCallback(error);
          }
        }
      };

      const handleError = (error) => {
        console.error('Firebase alerts listener error:', error);
        
        // Clean up the listener on error
        cleanupAlertListener(listenerKey);
        
        if (errorCallback) {
          errorCallback(error);
        }
      };
      
      // Set up the listener
      onValue(alertsQuery, handleValue, handleError);
      
      // Store the listener for cleanup
      activeAlertListeners.set(listenerKey, {
        cleanup: () => {
          try {
            console.log(`Unsubscribing alerts listener: ${listenerKey}`);
            off(alertsQuery, 'value', handleValue);
          } catch (error) {
            console.error('Error cleaning up alerts listener:', error);
          }
        },
        userId,
        type: 'alerts'
      });
      
      console.log(`Alerts listener established: ${listenerKey}`);
      
      // Return cleanup function
      return () => cleanupAlertListener(listenerKey);
      
    } catch (error) {
      console.error('Error initializing alerts listener:', error);
      if (errorCallback) {
        errorCallback(error);
      }
      return () => {};
    }
  },

  // Create leak detection alert
  createLeakAlert: async (userId, deviceId, deviceName, flowRate, duration) => {
    try {
      const alertData = {
        type: 'leak_detected',
        title: '🚨 Leak Detected!',
        message: `Possible water leak detected on ${deviceName}. Flow rate: ${flowRate.toFixed(1)} L/min for ${duration} minutes.`,
        deviceId,
        deviceName,
        data: {
          flowRate,
          duration,
          timestamp: new Date().toISOString(),
          severity: flowRate > 10 ? 'high' : flowRate > 5 ? 'medium' : 'low'
        }
      };
      
      // Create in-app notification
      const result = await alertService.createAlert(userId, alertData);
      
      if (result.success) {
        // Send email notification
        await alertService.sendEmailNotification(userId, alertData);
        
        // Send SMS notification if phone number exists
        await alertService.sendSMSNotification(userId, alertData);
      }
      
      return result;
    } catch (error) {
      console.error('Error creating leak alert:', error);
      return { success: false, error: error.message };
    }
  },

  // Create low battery alert
  createLowBatteryAlert: async (userId, deviceId, deviceName, batteryLevel) => {
    try {
      const alertData = {
        type: 'low_battery',
        title: '🔋 Low Battery Alert',
        message: `${deviceName} battery is low (${batteryLevel}%). Please charge or replace batteries soon.`,
        deviceId,
        deviceName,
        data: {
          batteryLevel,
          timestamp: new Date().toISOString(),
          actionRequired: batteryLevel < 10
        }
      };
      
      // Create in-app notification
      const result = await alertService.createAlert(userId, alertData);
      
      if (result.success) {
        // Send email notification
        await alertService.sendEmailNotification(userId, alertData);
        
        // Send SMS notification if phone number exists
        await alertService.sendSMSNotification(userId, alertData);
      }
      
      return result;
    } catch (error) {
      console.error('Error creating low battery alert:', error);
      return { success: false, error: error.message };
    }
  },

  // Send email notification (simplified - in production use Firebase Cloud Functions or email service)
  sendEmailNotification: async (userId, alertData) => {
    try {
      // Get user email from Firebase Auth
      const auth = getFirebaseAuth();
      const user = auth.currentUser;
      
      if (!user?.email) {
        console.log('No email found for user, skipping email notification');
        return { success: false, error: 'No email address found' };
      }
      
      // In production, you would:
      // 1. Call a Firebase Cloud Function to send email
      // 2. Use a service like SendGrid, AWS SES, etc.
      // 3. Use Firebase Extensions for email
      
      console.log(`📧 Email notification prepared for: ${user.email}`);
      console.log(`Alert: ${alertData.title} - ${alertData.message}`);
      
      // For now, just log the email content
      // Implement your email service integration here
      
      return { success: true };
    } catch (error) {
      console.error('Error preparing email notification:', error);
      return { success: false, error: error.message };
    }
  },

  // Send SMS notification (simplified - in production use Firebase Cloud Functions or SMS service)
  sendSMSNotification: async (userId, alertData) => {
    try {
      // Get user profile to check for phone number
      const database = getFirebaseDatabase();
      const profileRef = ref(database, `users/${userId}/profile`);
      const snapshot = await get(profileRef);
      
      if (!snapshot.exists()) {
        console.log('No profile found for user, skipping SMS notification');
        return { success: false, error: 'No profile found' };
      }
      
      const profile = snapshot.val();
      const phoneNumber = profile.phoneNumber;
      
      if (!phoneNumber) {
        console.log('No phone number found for user, skipping SMS notification');
        return { success: false, error: 'No phone number found' };
      }
      
      // In production, you would:
      // 1. Call a Firebase Cloud Function to send SMS
      // 2. Use a service like Twilio, AWS SNS, etc.
      // 3. Use Firebase Extensions for SMS
      
      console.log(`📱 SMS notification prepared for: ${phoneNumber}`);
      console.log(`Alert: ${alertData.title} - ${alertData.message}`);
      
      // For now, just log the SMS content
      // Implement your SMS service integration here
      
      return { success: true };
    } catch (error) {
      console.error('Error preparing SMS notification:', error);
      return { success: false, error: error.message };
    }
  },

  // Get unread alert count
  getUnreadAlertCount: async (userId) => {
    try {
      const result = await alertService.getUserAlerts(userId);
      if (result.success) {
        const unreadCount = result.alerts?.filter(alert => !alert.read)?.length || 0;
        return { success: true, count: unreadCount };
      }
      return { success: false, count: 0 };
    } catch (error) {
      console.error('Error getting unread alert count:', error);
      return { success: false, count: 0, error: error.message };
    }
  },

  // Cleanup all alert listeners
  cleanupAllAlertListeners: () => {
    console.log(`Cleaning up all alert listeners (${activeAlertListeners.size} active)`);
    
    activeAlertListeners.forEach((listener, key) => {
      console.log(`Cleaning up alert listener: ${key}`);
      try {
        listener.cleanup();
      } catch (error) {
        console.error(`Error cleaning up alert listener ${key}:`, error);
      }
    });
    
    activeAlertListeners.clear();
    console.log('All alert listeners cleaned up');
  },

  // Get active alert listeners info
  getActiveAlertListeners: () => {
    const listeners = [];
    activeAlertListeners.forEach((listener, key) => {
      listeners.push({
        key,
        userId: listener.userId,
        type: listener.type
      });
    });
    return listeners;
  }
};