import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
  Dimensions,
  ActivityIndicator,
  BackHandler,
  StatusBar,
  RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { authService } from '../services/authService';
import { deviceService } from '../services/deviceService';
import { getDatabase, ref, update, onValue, off, get, set, remove } from 'firebase/database';
import { useTabBar } from '../context/TabBarContext';
import { useScrollHandler } from '../hooks/useScrollHandler';
import { useFocusEffect } from '@react-navigation/native';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';

const AnimatedView = Animated.createAnimatedComponent(View);
const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

const { width } = Dimensions.get('window');

const ProfileScreen = ({ navigation }) => {
  const { user, logout, updateUserName } = useAuth();
  const { showTabBar } = useTabBar();
  
  const { 
    handleScroll, 
    onScrollBeginDrag,
    onMomentumScrollEnd,
    onScrollEndDrag 
  } = useScrollHandler();

  const mountedRef = useRef(true);
  
  const [userData, setUserData] = useState({
    name: '',
    email: '',
    phoneNumber: '',
  });
  
  const [devices, setDevices] = useState([]);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showRemoveDeviceModal, setShowRemoveDeviceModal] = useState(false);
  const [editingDevice, setEditingDevice] = useState(null);
  const [deviceToRemove, setDeviceToRemove] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  
  const [loadingStates, setLoadingStates] = useState({
    userData: true,
    devices: true,
    updatingProfile: false,
    updatingDevice: false,
    removingDevice: false,
  });

  // Initialize mountedRef
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Modal animation values
  const modalScale = useSharedValue(0);
  const removeDeviceModalScale = useSharedValue(0);

  const setLoading = useCallback((key, value) => {
    if (mountedRef.current) {
      setLoadingStates(prev => ({ ...prev, [key]: value }));
    }
  }, []);

  // Focus effect
  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => showTabBar(), 100);
      return () => clearTimeout(timer);
    }, [showTabBar])
  );

  // Modal animations
  useEffect(() => {
    if (showEditModal) {
      modalScale.value = withSpring(1, { damping: 12, stiffness: 400, mass: 0.5 });
    } else {
      modalScale.value = withTiming(0, { duration: 150, easing: Easing.in(Easing.ease) });
    }
  }, [showEditModal]);

  useEffect(() => {
    if (showRemoveDeviceModal) {
      removeDeviceModalScale.value = withSpring(1, { damping: 12, stiffness: 400, mass: 0.5 });
    } else {
      removeDeviceModalScale.value = withTiming(0, { duration: 150, easing: Easing.in(Easing.ease) });
    }
  }, [showRemoveDeviceModal]);

  const modalAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: modalScale.value }],
    opacity: modalScale.value,
  }));

  const removeDeviceModalAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: removeDeviceModalScale.value }],
    opacity: removeDeviceModalScale.value,
  }));

  // Load user data with fallback
  const loadUserData = useCallback(async () => {
    if (!user?.uid) return;

    setLoading('userData', true);
    try {
      const db = getDatabase();
      const userRef = ref(db, `users/${user.uid}/profile`);
      const snapshot = await get(userRef);
      
      if (mountedRef.current) {
        if (snapshot.exists()) {
          const data = snapshot.val();
          setUserData({
            name: data.name || user.displayName || '',
            email: data.email || user.email || '',
            phoneNumber: data.phoneNumber || '',
          });
        } else {
          setUserData({
            name: user.displayName || '',
            email: user.email || '',
            phoneNumber: '',
          });
        }
      }
    } catch (error) {
      console.error('Error loading user data:', error);
      if (mountedRef.current) {
        setUserData({
          name: user.displayName || '',
          email: user.email || '',
          phoneNumber: '',
        });
      }
    } finally {
      if (mountedRef.current) {
        setLoading('userData', false);
      }
    }
  }, [user?.uid, user?.displayName, user?.email, setLoading]);

  // Load devices with REAL-TIME status listeners
  const loadDevices = useCallback(async () => {
    if (!user?.uid) return;

    setLoading('devices', true);
    try {
      const db = getDatabase();
      const userDevicesRef = ref(db, `users/${user.uid}/devices`);
      const snapshot = await get(userDevicesRef);
      
      if (snapshot.exists()) {
        const devicesData = snapshot.val();
        const devicesList = [];
        
        // For each device, get the actual status from devices/$deviceId/info
        for (const [key, device] of Object.entries(devicesData)) {
          const deviceId = device.deviceId || key;
          
          // Get real-time device info including status
          const deviceInfoRef = ref(db, `devices/${deviceId}/info`);
          const deviceDataRef = ref(db, `devices/${deviceId}/data`);
          
          try {
            const [deviceInfoSnapshot, deviceDataSnapshot] = await Promise.all([
              get(deviceInfoRef),
              get(deviceDataRef)
            ]);
            
            let actualStatus = 'offline';
            let lastSeen = null;
            
            // Check device info for status
            if (deviceInfoSnapshot.exists()) {
              const deviceInfo = deviceInfoSnapshot.val();
              actualStatus = deviceInfo.status || 'offline';
              lastSeen = deviceInfo.lastSeen;
              
              // Additional check: if lastSeen is more than 5 minutes old, mark as offline
              if (lastSeen) {
                const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
                if (lastSeen < fiveMinutesAgo && actualStatus === 'online') {
                  actualStatus = 'offline';
                }
              }
            }
            
            // Also check device data for latest status
            if (deviceDataSnapshot.exists()) {
              const deviceData = deviceDataSnapshot.val();
              if (deviceData.status) {
                actualStatus = deviceData.status;
              }
              // Check timestamp from data
              if (deviceData.timestamp) {
                const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
                if (deviceData.timestamp < fiveMinutesAgo && actualStatus === 'online') {
                  actualStatus = 'offline';
                }
              }
            }
            
            console.log(`Device ${deviceId} status: ${actualStatus}, lastSeen: ${lastSeen}`);
            
            devicesList.push({
              id: key,
              deviceId: deviceId,
              name: device.name || 'Water Monitor',
              location: device.location || 'Main Supply',
              status: actualStatus, // Use the actual status
              totalUsage: device.totalUsage || 0,
              batteryLevel: device.batteryLevel || 0,
              signalStrength: device.signalStrength || 'Unknown',
            });
          } catch (error) {
            console.error(`Error loading device ${deviceId}:`, error);
            // If we can't get device info, add it with offline status
            devicesList.push({
              id: key,
              deviceId: deviceId,
              name: device.name || 'Water Monitor',
              location: device.location || 'Main Supply',
              status: 'offline',
              totalUsage: device.totalUsage || 0,
              batteryLevel: device.batteryLevel || 0,
              signalStrength: device.signalStrength || 'Unknown',
            });
          }
        }
        
        if (mountedRef.current) {
          setDevices(devicesList);
        }
      } else {
        if (mountedRef.current) {
          setDevices([]);
        }
      }
    } catch (error) {
      console.error('Error loading devices:', error);
      if (mountedRef.current) {
        setDevices([]);
      }
    } finally {
      if (mountedRef.current) {
        setLoading('devices', false);
      }
    }
  }, [user?.uid, setLoading]);

  // Set up real-time listeners for device status updates
  useEffect(() => {
    if (!user?.uid || devices.length === 0) return;

    const db = getDatabase();
    const listeners = [];

    // Set up listener for each device
    devices.forEach((device) => {
      const deviceId = device.deviceId;
      
      // Listen to device info changes
      const deviceInfoRef = ref(db, `devices/${deviceId}/info`);
      const infoListener = onValue(deviceInfoRef, (snapshot) => {
        if (snapshot.exists() && mountedRef.current) {
          const deviceInfo = snapshot.val();
          let newStatus = deviceInfo.status || 'offline';
          const lastSeen = deviceInfo.lastSeen;
          
          // Check if device is really online based on lastSeen
          if (lastSeen) {
            const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
            if (lastSeen < fiveMinutesAgo && newStatus === 'online') {
              newStatus = 'offline';
            }
          }
          
          // Update only this device's status
          setDevices(prevDevices => 
            prevDevices.map(d => 
              d.deviceId === deviceId 
                ? { ...d, status: newStatus }
                : d
            )
          );
          
          console.log(`Real-time update: Device ${deviceId} status changed to ${newStatus}`);
        }
      });
      
      // Listen to device data changes
      const deviceDataRef = ref(db, `devices/${deviceId}/data`);
      const dataListener = onValue(deviceDataRef, (snapshot) => {
        if (snapshot.exists() && mountedRef.current) {
          const deviceData = snapshot.val();
          let newStatus = deviceData.status || 'offline';
          const timestamp = deviceData.timestamp;
          
          // Check if device is really online based on timestamp
          if (timestamp) {
            const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
            if (timestamp < fiveMinutesAgo && newStatus === 'online') {
              newStatus = 'offline';
            }
          }
          
          // Update only this device's status
          setDevices(prevDevices => 
            prevDevices.map(d => 
              d.deviceId === deviceId 
                ? { 
                    ...d, 
                    status: newStatus,
                    totalUsage: deviceData.totalLitres || d.totalUsage,
                    batteryLevel: deviceData.batteryPercentage || d.batteryLevel
                  }
                : d
            )
          );
          
          console.log(`Real-time data update: Device ${deviceId} - status: ${newStatus}, usage: ${deviceData.totalLitres}`);
        }
      });
      
      listeners.push({ ref: deviceInfoRef, unsubscribe: infoListener });
      listeners.push({ ref: deviceDataRef, unsubscribe: dataListener });
    });

    // Cleanup listeners when component unmounts or devices change
    return () => {
      listeners.forEach(({ ref: listenerRef, unsubscribe }) => {
        off(listenerRef, 'value', unsubscribe);
      });
    };
  }, [user?.uid, devices.length]); // Re-run when device list changes

  // Remove device function
  const handleRemoveDevice = useCallback(async () => {
    if (!deviceToRemove || !user?.uid || loadingStates.removingDevice) return;

    setLoading('removingDevice', true);
    try {
      const result = await deviceService.removeDevice(user.uid, deviceToRemove.id);
      
      if (result.success) {
        if (mountedRef.current) {
          Alert.alert('Success', 'Device removed successfully');
          setShowRemoveDeviceModal(false);
          setDeviceToRemove(null);
          await loadDevices();
        }
      } else {
        throw new Error(result.error || 'Failed to remove device');
      }
    } catch (error) {
      console.error('Device removal error:', error);
      if (mountedRef.current) {
        Alert.alert(
          'Error', 
          'Failed to remove device. Please try again.'
        );
      }
    } finally {
      if (mountedRef.current) {
        setLoading('removingDevice', false);
      }
    }
  }, [deviceToRemove, user?.uid, loadingStates.removingDevice, setLoading, loadDevices]);

  // Show remove device confirmation
  const showRemoveDeviceConfirmation = useCallback((device) => {
    setDeviceToRemove(device);
    setShowRemoveDeviceModal(true);
  }, []);

  // Initial load
  useEffect(() => {
    if (user?.uid) {
      loadUserData();
      loadDevices();
    }
  }, [user?.uid, loadUserData, loadDevices]);

  // Back handler
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showEditModal) {
        setShowEditModal(false);
        setEditingDevice(null);
        return true;
      }
      if (showRemoveDeviceModal) {
        setShowRemoveDeviceModal(false);
        setDeviceToRemove(null);
        return true;
      }
      return false;
    });

    return () => backHandler.remove();
  }, [showEditModal, showRemoveDeviceModal]);

  // Pull to refresh
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadUserData(), loadDevices()]);
    if (mountedRef.current) {
      setRefreshing(false);
    }
  }, [loadUserData, loadDevices]);

  // Update profile - MODIFIED TO UPDATE USERNAME IN AUTH CONTEXT
  const handleUpdateProfile = useCallback(async () => {
    if (!user?.uid || loadingStates.updatingProfile) return;

    setLoading('updatingProfile', true);
    try {
      const db = getDatabase();
      const userRef = ref(db, `users/${user.uid}/profile`);
      
      await update(userRef, {
        name: userData.name,
        email: userData.email,
        phoneNumber: userData.phoneNumber,
        updatedAt: Date.now()
      });

      // Update the user name in auth context so it syncs with HomeScreen
      if (userData.name && updateUserName) {
        await updateUserName(userData.name);
      }

      if (mountedRef.current) {
        Alert.alert('Success', 'Profile updated successfully');
        setShowEditModal(false);
      }
    } catch (error) {
      console.error('Profile update error:', error);
      if (mountedRef.current) {
        Alert.alert('Error', 'Failed to update profile');
      }
    } finally {
      if (mountedRef.current) {
        setLoading('updatingProfile', false);
      }
    }
  }, [user?.uid, userData, loadingStates.updatingProfile, setLoading, updateUserName]);

  // Update device - COMPLETELY FIXED VERSION
  const handleUpdateDevice = useCallback(async () => {
    if (!editingDevice || !user?.uid || loadingStates.updatingDevice) return;

    // Validate that name is not empty
    if (!editingDevice.name || editingDevice.name.trim() === '') {
      Alert.alert('Error', 'Device name cannot be empty');
      return;
    }

    setLoading('updatingDevice', true);
    try {
      const db = getDatabase();
      
      // Update BOTH locations:
      // 1. User's device list
      const userDeviceRef = ref(db, `users/${user.uid}/devices/${editingDevice.id}`);
      await update(userDeviceRef, {
        name: editingDevice.name.trim(),
        location: editingDevice.location?.trim() || '',
      });
      
      // 2. Device info (so it shows in other places too)
      const deviceInfoRef = ref(db, `devices/${editingDevice.deviceId}/info`);
      await update(deviceInfoRef, {
        name: editingDevice.name.trim(),
        location: editingDevice.location?.trim() || '',
      });

      if (mountedRef.current) {
        Alert.alert('Success', 'Device updated successfully');
        setShowEditModal(false);
        setEditingDevice(null);
        await loadDevices();
      }
    } catch (error) {
      console.error('Device update error:', error);
      if (mountedRef.current) {
        Alert.alert('Error', 'Failed to update device. Please try again.');
      }
    } finally {
      if (mountedRef.current) {
        setLoading('updatingDevice', false);
      }
    }
  }, [editingDevice, user?.uid, loadingStates.updatingDevice, setLoading, loadDevices]);

  const handleLogout = useCallback(() => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await logout();
              if (!result?.success) {
                Alert.alert('Error', 'Failed to logout');
              }
            } catch (error) {
              console.error('Logout error:', error);
              Alert.alert('Error', 'Failed to logout');
            }
          }
        }
      ]
    );
  }, [logout]);

  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      'Delete Account',
      'This action cannot be undone. All your data will be permanently deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => Alert.alert('Info', 'Account deletion feature coming soon')
        }
      ]
    );
  }, []);

  const formatUsage = useCallback((liters) => {
    const usage = parseFloat(liters) || 0;
    if (usage >= 1000) return `${(usage / 1000).toFixed(1)}k L`;
    return `${usage.toFixed(0)} L`;
  }, []);

  // FIXED: Get status color based on actual device status
  const getStatusColor = useCallback((status) => {
    const statusLower = status?.toLowerCase() || '';
    
    // Check for online/active states
    if (statusLower === 'online' || statusLower === 'active') {
      return '#10B981';
    }
    
    // Check for offline/inactive states  
    if (statusLower === 'offline' || statusLower === 'inactive') {
      return '#EF4444';
    }
    
    // Alert states
    if (statusLower === 'alert') {
      return '#F59E0B';
    }
    
    // Default to gray for unknown states
    return '#6B7280';
  }, []);

  // Safe device ID display
  const getDeviceIdDisplay = useCallback((device) => {
    const deviceId = device.deviceId || device.id;
    if (!deviceId) return '...';
    return deviceId.substring(0, 12) + '...';
  }, []);

  if (!user) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={['#030712', '#111827', '#000000']}
          style={[styles.gradient, { justifyContent: 'center', alignItems: 'center' }]}
        >
          <Ionicons name="lock-closed" size={60} color="#9ca3af" />
          <Text style={styles.notAuthTitle}>Authentication Required</Text>
          <Text style={styles.notAuthSubtext}>
            Please sign in to view your profile
          </Text>
        </LinearGradient>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      {/* Fixed Header */}
      <View style={styles.fixedHeader}>
        <LinearGradient
          colors={['#030712', '#111827']}
          style={styles.headerGradient}
        >
          <View style={styles.headerContent}>
            <TouchableOpacity 
              style={styles.backButton}
              onPress={() => navigation.goBack()}
            >
              <LinearGradient
                colors={['#F59E0B20', '#F9731620']}  
                style={styles.backIconContainer}
              >
                <Ionicons name="arrow-back" size={24} color="#F59E0B" /> 
              </LinearGradient>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Profile</Text>
            <View style={styles.headerSpacer} />
          </View>
        </LinearGradient>
      </View>

      <LinearGradient
        colors={['#030712', '#111827', '#000000']}
        style={styles.gradient}
      >
        <ScrollView 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}  
          onScroll={handleScroll}
          scrollEventThrottle={16}
          onScrollBeginDrag={onScrollBeginDrag}
          onMomentumScrollEnd={onMomentumScrollEnd}
          onScrollEndDrag={onScrollEndDrag}
          refreshControl={
            <RefreshControl 
              refreshing={refreshing} 
              onRefresh={onRefresh} 
              tintColor="#F59E0B"
              colors={['#F59E0B']}
            />
          }
        >
          {/* Profile Card */}
          <View style={styles.profileSection}>
            <TouchableOpacity 
              style={styles.profileCard}
              onPress={() => setShowEditModal(true)}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#1f293780', '#11182780']}
                style={styles.profileCardGradient}
              >
                <View style={styles.profileHeader}>
                  <LinearGradient
                    colors={['#06b6d4', '#0891b2']}
                    style={styles.avatarContainer}
                  >
                    <Text style={styles.avatarText}>
                      {(userData.name || userData.email || 'U').charAt(0).toUpperCase()}
                    </Text>
                  </LinearGradient>
                  <View style={styles.profileInfo}>
                    <Text style={styles.profileName}>{userData.name || 'User'}</Text>
                    <Text style={styles.profileEmail}>{userData.email}</Text>
                    {userData.phoneNumber && (
                      <Text style={styles.profilePhone}>{userData.phoneNumber}</Text>
                    )}
                  </View>
                  <Ionicons name="create" size={24} color="#06b6d4" />
                </View>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* Devices Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Your Devices</Text>
              {devices.length > 0 && (
                <View style={styles.deviceCountBadge}>
                  <Text style={styles.deviceCountText}>{devices.length}</Text>
                </View>
              )}
            </View>
            
            {loadingStates.devices ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color="#F59E0B" />
                <Text style={styles.loadingText}>Loading devices...</Text>
              </View>
            ) : devices.length > 0 ? (
              devices.map((device, index) => (
                <TouchableOpacity 
                  key={device.id || index}
                  style={styles.deviceCard}
                  onPress={() => {
                    setEditingDevice({ ...device });
                    setShowEditModal(true);
                  }}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={['#1f293780', '#11182780']}
                    style={styles.deviceCardGradient}
                  >
                    <View style={styles.deviceHeader}>
                      <View style={styles.deviceIconContainer}>
                        <Ionicons name="water" size={24} color="#06b6d4" />
                      </View>
                      <View style={styles.deviceInfo}>
                        <Text style={styles.deviceName}>
                          {device.name || `Water Monitor ${index + 1}`}
                        </Text>
                        <Text style={styles.deviceLocation}>
                          {device.location || 'Main Supply'}
                        </Text>
                        <Text style={styles.deviceId}>
                          ID: {getDeviceIdDisplay(device)}
                        </Text>
                      </View>
                      <View style={styles.deviceRight}>
                        <View style={styles.statusIndicator}>
                          <View style={[
                            styles.statusDot, 
                            { backgroundColor: getStatusColor(device.status) }
                          ]} />
                          <Text style={styles.statusText}>
                            {(device.status || 'unknown').toUpperCase()}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={24} color="#9ca3af" />
                      </View>
                    </View>
                    
                    <View style={styles.deviceStats}>
                      <View style={styles.statItem}>
                        <Text style={styles.statLabel}>Total Usage</Text>
                        <Text style={styles.statValue}>
                          {formatUsage(device.totalUsage || device.totalLitres || 0)}
                        </Text>
                      </View>
                      
                      <TouchableOpacity
                        style={[
                          styles.removeButton,
                          { 
                            backgroundColor: '#EF444420',
                            borderColor: '#EF4444'
                          }
                        ]}
                        onPress={(e) => {
                          e.stopPropagation();
                          showRemoveDeviceConfirmation(device);
                        }}
                      >
                        <Ionicons 
                          name="trash-outline" 
                          size={18} 
                          color="#EF4444" 
                        />
                      </TouchableOpacity>
                    </View>
                  </LinearGradient>
                </TouchableOpacity>
              ))
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="water-outline" size={60} color="#37415180" />
                <Text style={styles.emptyStateText}>No Devices Connected</Text>
                <Text style={styles.emptyStateSubtext}>
                  Add your first device to get started
                </Text>
              </View>
            )}
          </View>

          {/* Settings Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Settings</Text>
            <View style={styles.settingsCard}>
              <TouchableOpacity
                style={styles.settingsItem}
                onPress={() => navigation.navigate('About')}
              >
                <View style={[styles.settingsIconBox, { backgroundColor: '#06b6d420' }]}>
                  <Ionicons name="information-circle" size={22} color="#06b6d4" />
                </View>
                <Text style={styles.settingsLabel}>About</Text>
                <Ionicons name="chevron-forward" size={24} color="#9ca3af" />
              </TouchableOpacity>
              
              <View style={styles.divider} />
              
              <TouchableOpacity
                style={styles.settingsItem}
                onPress={handleLogout}
              >
                <View style={[styles.settingsIconBox, { backgroundColor: '#F59E0B20' }]}>
                  <Ionicons name="log-out" size={22} color="#F59E0B" />
                </View>
                <Text style={styles.settingsLabel}>Logout</Text>
                <Ionicons name="chevron-forward" size={24} color="#9ca3af" />
              </TouchableOpacity>
              
              <View style={styles.divider} />
              
              <TouchableOpacity
                style={styles.settingsItem}
                onPress={handleDeleteAccount}
              >
                <View style={[styles.settingsIconBox, { backgroundColor: '#EF444420' }]}>
                  <Ionicons name="trash" size={22} color="#EF4444" />
                </View>
                <Text style={[styles.settingsLabel, { color: '#EF4444' }]}>Delete Account</Text>
                <Ionicons name="chevron-forward" size={24} color="#9ca3af" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ height: 100 }} />
        </ScrollView>
      </LinearGradient>

      {/* Edit Profile Modal */}
      <Modal
        visible={showEditModal}
        transparent
        animationType="none"
        onRequestClose={() => {
          setShowEditModal(false);
          setEditingDevice(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <AnimatedView style={[styles.modalContent, modalAnimatedStyle]}>
            <LinearGradient
              colors={['#1F2937', '#111827']}
              style={styles.modalGradient}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {editingDevice ? 'Edit Device' : 'Edit Profile'}
                </Text>
                <TouchableOpacity onPress={() => {
                  setShowEditModal(false);
                  setEditingDevice(null);
                }}>
                  <Ionicons name="close" size={24} color="#9ca3af" />
                </TouchableOpacity>
              </View>
              
              {editingDevice ? (
                <>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Device Name</Text>
                    <TextInput
                      style={styles.textInput}
                      value={editingDevice.name}
                      onChangeText={(text) => setEditingDevice(prev => ({ ...prev, name: text }))}
                      placeholder="Enter device name"
                      placeholderTextColor="#6B7280"
                      autoFocus={false}
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Location</Text>
                    <TextInput
                      style={styles.textInput}
                      value={editingDevice.location}
                      onChangeText={(text) => setEditingDevice(prev => ({ ...prev, location: text }))}
                      placeholder="Enter device location"
                      placeholderTextColor="#6B7280"
                    />
                  </View>
                  
                  <View style={styles.modalButtons}>
                    <TouchableOpacity
                      style={[styles.modalButton, styles.cancelButton]}
                      onPress={() => {
                        setShowEditModal(false);
                        setEditingDevice(null);
                      }}
                    >
                      <Text style={styles.cancelButtonText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modalButton, styles.saveButton]}
                      onPress={handleUpdateDevice}
                      disabled={loadingStates.updatingDevice}
                    >
                      <LinearGradient
                        colors={['#06b6d4', '#0891b2']}
                        style={styles.saveButtonGradient}
                      >
                        {loadingStates.updatingDevice ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Text style={styles.saveButtonText}>Update Device</Text>
                        )}
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Full Name</Text>
                    <TextInput
                      style={styles.textInput}
                      value={userData.name}
                      onChangeText={(text) => setUserData(prev => ({ ...prev, name: text }))}
                      placeholder="Enter your full name"
                      placeholderTextColor="#6B7280"
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Email Address</Text>
                    <TextInput
                      style={[styles.textInput, styles.disabledInput]}
                      value={userData.email}
                      editable={false}
                      placeholderTextColor="#6B7280"
                    />
                    <Text style={styles.helperText}>Email cannot be changed</Text>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Phone Number</Text>
                    <TextInput
                      style={styles.textInput}
                      value={userData.phoneNumber}
                      onChangeText={(text) => setUserData(prev => ({ ...prev, phoneNumber: text }))}
                      placeholder="Enter your phone number"
                      placeholderTextColor="#6B7280"
                      keyboardType="phone-pad"
                    />
                  </View>
                  
                  <View style={styles.modalButtons}>
                    <TouchableOpacity
                      style={[styles.modalButton, styles.cancelButton]}
                      onPress={() => setShowEditModal(false)}
                    >
                      <Text style={styles.cancelButtonText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modalButton, styles.saveButton]}
                      onPress={handleUpdateProfile}
                      disabled={loadingStates.updatingProfile}
                    >
                      <LinearGradient
                        colors={['#06b6d4', '#0891b2']}
                        style={styles.saveButtonGradient}
                      >
                        {loadingStates.updatingProfile ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Text style={styles.saveButtonText}>Save Changes</Text>
                        )}
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </LinearGradient>
          </AnimatedView>
        </View>
      </Modal>

      {/* Remove Device Confirmation Modal */}
      <Modal
        visible={showRemoveDeviceModal}
        transparent
        animationType="none"
        onRequestClose={() => {
          setShowRemoveDeviceModal(false);
          setDeviceToRemove(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <AnimatedView style={[styles.modalContent, removeDeviceModalAnimatedStyle]}>
            <LinearGradient
              colors={['#1F2937', '#111827']}
              style={styles.modalGradient}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Remove Device</Text>
                <TouchableOpacity onPress={() => {
                  setShowRemoveDeviceModal(false);
                  setDeviceToRemove(null);
                }}>
                  <Ionicons name="close" size={24} color="#9ca3af" />
                </TouchableOpacity>
              </View>

              <View style={styles.removeDeviceContent}>
                <Ionicons name="trash-outline" size={48} color="#EF4444" style={styles.removeDeviceIcon} />
                <Text style={styles.removeDeviceTitle}>
                  Remove {deviceToRemove?.name || 'Device'}?
                </Text>
                <Text style={styles.removeDeviceDescription}>
                  This will permanently remove the device from your account and delete all associated data. This action cannot be undone.
                </Text>
                
                <View style={styles.deviceInfoPreview}>
                  <Text style={styles.deviceInfoLabel}>Device ID:</Text>
                  <Text style={styles.deviceInfoValue}>
                    {getDeviceIdDisplay(deviceToRemove || {})}
                  </Text>
                </View>
              </View>
              
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={() => {
                    setShowRemoveDeviceModal(false);
                    setDeviceToRemove(null);
                  }}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.removeConfirmButton]}
                  onPress={handleRemoveDevice}
                  disabled={loadingStates.removingDevice}
                >
                  <LinearGradient
                    colors={['#EF4444', '#DC2626']}
                    style={styles.removeConfirmButtonGradient}
                  >
                    {loadingStates.removingDevice ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <Ionicons name="trash" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                        <Text style={styles.removeConfirmButtonText}>Remove Device</Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </LinearGradient>
          </AnimatedView>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  gradient: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingTop: 160,
    paddingBottom: 20,
  },
  
  // Fixed Header
  fixedHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  headerGradient: {
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    padding: 2,
  },
  backIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F59E0B40',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 48,
  },
  
  profileSection: {
    marginBottom: 30,
  },
  profileCard: {
    marginBottom: 30,
    borderRadius: 16,
    overflow: 'hidden',
  },
  profileCardGradient: {
    padding: 20,
    borderWidth: 1,
    borderColor: '#37415140',
    borderRadius: 16,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  avatarText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  profileEmail: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 2,
  },
  profilePhone: {
    fontSize: 13,
    color: '#6B7280',
  },
  
  section: {
    marginBottom: 30,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
  },
  deviceCountBadge: {
    backgroundColor: '#06b6d420',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#06b6d440',
  },
  deviceCountText: {
    fontSize: 12,
    color: '#06b6d4',
    fontWeight: '600',
  },
  
  deviceCard: {
    marginBottom: 16,
    borderRadius: 16,
    overflow: 'hidden',
  },
  deviceCardGradient: {
    padding: 16,
    borderWidth: 1,
    borderColor: '#37415140',
    borderRadius: 16,
  },
  deviceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  deviceIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#06b6d420',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#06b6d440',
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  deviceLocation: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 2,
  },
  deviceId: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  deviceRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
    backgroundColor: '#1f293780',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  statusText: {
    fontSize: 9,
    color: '#9ca3af',
    fontWeight: '600',
  },
  deviceStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#37415140',
  },
  statItem: {
    flex: 1,
  },
  statLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  
  removeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    marginLeft: 8,
  },
  
  settingsCard: {
    backgroundColor: '#1f293780',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#37415140',
    overflow: 'hidden',
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
  },
  settingsIconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  settingsLabel: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
    flex: 1,
  },
  divider: {
    height: 1,
    backgroundColor: '#37415140',
    marginHorizontal: 18,
  },
  
  emptyState: {
    alignItems: 'center',
    padding: 40,
    backgroundColor: '#1f293780',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#37415140',
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 16,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 8,
    textAlign: 'center',
  },
  
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  loadingText: {
    fontSize: 14,
    color: '#9ca3af',
    marginLeft: 10,
  },
  notAuthTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 20,
    textAlign: 'center',
  },
  notAuthSubtext: {
    fontSize: 16,
    color: '#9ca3af',
    marginTop: 10,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '85%',
    borderRadius: 20,
    overflow: 'hidden',
  },
  modalGradient: {
    padding: 24,
    borderWidth: 1,
    borderColor: '#37415140',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    color: '#9ca3af',
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  textInput: {
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#374151',
  },
  disabledInput: {
    backgroundColor: '#11182780',
    borderColor: '#37415140',
    color: '#6B7280',
  },
  helperText: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 6,
    fontStyle: 'italic',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  modalButton: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  cancelButton: {
    backgroundColor: '#1f2937',
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#374151',
  },
  saveButton: {
    shadowColor: '#06b6d4',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  saveButtonGradient: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  
  removeDeviceContent: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  removeDeviceIcon: {
    marginBottom: 16,
  },
  removeDeviceTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 12,
  },
  removeDeviceDescription: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  deviceInfoPreview: {
    backgroundColor: '#1f2937',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151',
    width: '100%',
  },
  deviceInfoLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 4,
  },
  deviceInfoValue: {
    fontSize: 11,
    color: '#6B7280',
    fontFamily: 'monospace',
  },
  removeConfirmButton: {
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  removeConfirmButtonGradient: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  removeConfirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default ProfileScreen;
