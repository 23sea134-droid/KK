import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
  Dimensions,
  AppState,
  TextInput,
  Modal,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useDeviceData } from '../context/DeviceDataContext';
import { deviceService } from '../services/deviceService';
import { alertService } from '../services/alertService';
import { useFocusEffect } from '@react-navigation/native';
import { useTabBar } from '../context/TabBarContext';
import { useScrollHandler } from '../hooks/useScrollHandler';
import { getDatabase, ref, onValue } from 'firebase/database';
import Svg, { 
  Circle, 
  Defs, 
  LinearGradient as SvgLinearGradient, 
  Stop,
} from 'react-native-svg';
import Animated, { 
  useSharedValue, 
  useAnimatedProps, 
  withTiming, 
  Easing,
  withRepeat,
  withSequence,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedView = Animated.createAnimatedComponent(View);

const { width } = Dimensions.get('window');
const CIRCLE_CONTAINER_SIZE = width * 0.70;
const STROKE_WIDTH = 20;
const RADIUS = (CIRCLE_CONTAINER_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const DEFAULT_DAILY_USAGE = 5000;

const HomeScreen = ({ navigation }) => {
  const { user } = useAuth();
  const { showTabBar } = useTabBar();
  
  // Use DeviceDataContext instead of local state
  const { 
    devices, 
    loading, 
    totalUsage,
    refreshDevices,
  } = useDeviceData();

  const { 
    handleScroll, 
    onScrollBeginDrag,
    onMomentumScrollEnd,
    onScrollEndDrag 
  } = useScrollHandler();

  // State Management
  const [refreshing, setRefreshing] = useState(false);
  const [dailyGoal, setDailyGoal] = useState(DEFAULT_DAILY_USAGE);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [tempGoal, setTempGoal] = useState('');
  const [userName, setUserName] = useState('');
  const [unreadAlerts, setUnreadAlerts] = useState(0);

  const unsubscribeAlertsRef = useRef(null);
  const profileUnsubscribeRef = useRef(null);
  const isMountedRef = useRef(true);

  // Animation Values
  const progress = useSharedValue(0);
  const pulseAnim = useSharedValue(1);
  const modalScale = useSharedValue(0);

  // Initialize user name
  useEffect(() => {
    if (user) {
      const name = user.displayName || user.email?.split('@')[0] || 'User';
      setUserName(name);
    }
  }, [user?.displayName, user?.email]);

  // Setup real-time listener for profile changes in Firebase
  useEffect(() => {
    if (!user?.uid) return;
    
    console.log('Setting up profile listener for user:', user.uid);
    
    try {
      const db = getDatabase();
      const profileRef = ref(db, `users/${user.uid}/profile`);
      
      const unsubscribe = onValue(profileRef, (snapshot) => {
        if (snapshot.exists() && isMountedRef.current) {
          const profileData = snapshot.val();
          console.log('Profile data updated:', profileData);
          
          if (profileData.name) {
            console.log('Profile name updated to:', profileData.name);
            setUserName(profileData.name);
          }
        }
      }, (error) => {
        console.error('Profile listener error:', error);
      });
      
      profileUnsubscribeRef.current = unsubscribe;
      
      return () => {
        if (profileUnsubscribeRef.current) {
          profileUnsubscribeRef.current();
          profileUnsubscribeRef.current = null;
        }
      };
    } catch (error) {
      console.error('Error setting up profile listener:', error);
    }
  }, [user?.uid]);

  // Setup alerts listener
  useEffect(() => {
    if (!user?.uid) return;

    const setupAlertsListener = async () => {
      try {
        // Get initial unread count
        const alertsResult = await alertService.getUserAlerts(user.uid);
        if (alertsResult.success && isMountedRef.current) {
          const unreadCount = alertsResult.alerts?.filter(alert => !alert.read)?.length || 0;
          setUnreadAlerts(unreadCount);
        }

        // Listen for new alerts
        const unsubscribe = alertService.listenToUserAlerts(
          user.uid,
          (alerts) => {
            if (isMountedRef.current && Array.isArray(alerts)) {
              const unreadCount = alerts.filter(alert => !alert.read)?.length || 0;
              setUnreadAlerts(unreadCount);
            }
          },
          (error) => {
            console.error('Alerts listener error:', error);
          }
        );

        unsubscribeAlertsRef.current = unsubscribe;
      } catch (error) {
        console.error('Error setting up alerts listener:', error);
      }
    };

    setupAlertsListener();

    return () => {
      if (unsubscribeAlertsRef.current) {
        unsubscribeAlertsRef.current();
        unsubscribeAlertsRef.current = null;
      }
    };
  }, [user?.uid]);

  // Start continuous animations
  useEffect(() => {
    pulseAnim.value = withRepeat(
      withSequence(
        withTiming(1.015, { duration: 2000, easing: Easing.bezier(0.4, 0.0, 0.2, 1) }),
        withTiming(1, { duration: 2000, easing: Easing.bezier(0.4, 0.0, 0.2, 1) })
      ),
      -1,
      false
    );
  }, []);

  // Modal animations
  useEffect(() => {
    if (showGoalModal) {
      modalScale.value = withSpring(1, {
        damping: 12,
        stiffness: 400,
        mass: 0.5,
      });
    } else {
      modalScale.value = withTiming(0, {
        duration: 150,
        easing: Easing.in(Easing.ease),
      });
    }
  }, [showGoalModal]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseAnim.value }],
  }));

  const modalAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: modalScale.value }],
    opacity: modalScale.value,
  }));

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => showTabBar(), 100);
      return () => clearTimeout(timer);
    }, [showTabBar])
  );

  useEffect(() => {
    const newProgress = Math.min(totalUsage / dailyGoal, 1);
    progress.value = withSpring(newProgress, {
      damping: 15,
      stiffness: 150,
      mass: 0.8,
    });
  }, [totalUsage, dailyGoal, progress]);

  const getUsageGradientColors = useCallback(() => {
    const usagePercentage = Math.min(totalUsage / dailyGoal, 1);
    if (usagePercentage <= 0.3) return ['#10B981', '#34D399', '#6EE7B7'];
    else if (usagePercentage <= 0.7) return ['#F59E0B', '#FBBF24', '#FCD34D'];
    else return ['#EF4444', '#F87171', '#FCA5A5'];
  }, [totalUsage, dailyGoal]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRCUMFERENCE * (1 - progress.value),
  }));

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      if (unsubscribeAlertsRef.current) {
        unsubscribeAlertsRef.current();
        unsubscribeAlertsRef.current = null;
      }
      if (profileUnsubscribeRef.current) {
        profileUnsubscribeRef.current();
        profileUnsubscribeRef.current = null;
      }
    };
  }, []);

  const onRefresh = useCallback(async () => {
    if (!user?.uid) return;
    setRefreshing(true);
    try {
      await refreshDevices();
    } catch (error) {
      console.error('Refresh error:', error);
      Alert.alert('Error', 'Failed to refresh device data');
    } finally {
      if (isMountedRef.current) setRefreshing(false);
    }
  }, [user?.uid, refreshDevices]);

  const handleGoalPress = useCallback(() => {
    setTempGoal(dailyGoal.toString());
    setShowGoalModal(true);
  }, [dailyGoal]);

  const handleSaveGoal = useCallback(() => {
    const newGoal = parseFloat(tempGoal);
    if (!isNaN(newGoal) && newGoal > 0) {
      setDailyGoal(newGoal);
      setShowGoalModal(false);
      Alert.alert('Success', `Daily goal updated to ${formatUsage(newGoal)}`);
    } else {
      Alert.alert('Invalid Goal', 'Please enter a valid positive number');
    }
  }, [tempGoal]);

  const handleValveControl = useCallback(async (deviceId, currentStatus) => {
    try {
      const newStatus = currentStatus === 'open' ? 'closed' : 'open';
      Alert.alert(
        'Control Valve',
        `${newStatus === 'open' ? 'Open' : 'Close'} valve for this device?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Confirm',
            onPress: async () => {
              try {
                const result = await deviceService.controlValve(deviceId, newStatus === 'open');
                if (result.success) {
                  Alert.alert('Success', `Valve ${newStatus} successfully`);
                  onRefresh();
                } else {
                  Alert.alert('Error', result.error || 'Failed to control valve');
                }
              } catch (error) {
                console.error('Valve control error:', error);
                Alert.alert('Error', 'Failed to control valve');
              }
            }
          }
        ]
      );
    } catch (error) {
      console.error('Valve control handler error:', error);
    }
  }, [onRefresh]);

  const handleQuickAction = useCallback((action) => {
    switch (action) {
      case 'addDevice':
        navigation.navigate('QRScan');
        break;
      case 'analytics':
        navigation.navigate('Analytics');
        break;
      case 'settings':
        navigation.navigate('Profile');
        break;
      case 'status':
        navigation.navigate('Status');
        break;
      default:
        console.warn('Unknown quick action:', action);
    }
  }, [navigation]);

  const handleAlertsPress = useCallback(() => {
    navigation.navigate('Alerts');
  }, [navigation]);

  const formatUsage = useCallback((liters) => {
    const usage = parseFloat(liters) || 0;
    if (usage >= 1000) return `${(usage / 1000).toFixed(1)}k L`;
    return `${usage.toFixed(0)} L`;
  }, []);

  const getStatusColor = useCallback((status) => {
    switch (status?.toLowerCase()) {
      case 'online':
      case 'active':
        return '#10B981';
      case 'offline':
      case 'inactive':
        return '#EF4444';
      case 'warning':
        return '#F59E0B';
      default:
        return '#6B7280';
    }
  }, []);

  const renderDeviceCard = useCallback((device, index) => {
    return (
      <TouchableOpacity 
        key={device.deviceId || device.id || index}
        style={styles.deviceCard}
        onPress={() => navigation.navigate('DeviceDetail', { deviceId: device.deviceId || device.id })}
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
            </View>
            <View style={[
              styles.statusDot, 
              { backgroundColor: getStatusColor(device.status) }
            ]} />
          </View>
          
          <View style={styles.deviceStats}>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Today's Usage</Text>
              <Text style={styles.statValue}>
                {formatUsage(device.totalUsage || device.totalLitres || 0)}
              </Text>
            </View>
            
            {(device.valveState || device.valveStatus) && (
              <TouchableOpacity
                style={[
                  styles.valveButton,
                  { 
                    backgroundColor: (device.valveStatus === 'open' || device.valveState === 'OPEN') ? '#10B98120' : '#EF444420',
                    borderColor: (device.valveStatus === 'open' || device.valveState === 'OPEN') ? '#10B981' : '#EF4444'
                  }
                ]}
                onPress={() => handleValveControl(
                  device.deviceId || device.id, 
                  device.valveStatus || (device.valveState === 'OPEN' ? 'open' : 'closed')
                )}
              >
                <Ionicons 
                  name={(device.valveStatus === 'open' || device.valveState === 'OPEN') ? 'water' : 'water-outline'} 
                  size={18} 
                  color={(device.valveStatus === 'open' || device.valveState === 'OPEN') ? '#10B981' : '#EF4444'} 
                />
              </TouchableOpacity>
            )}
          </View>
        </LinearGradient>
      </TouchableOpacity>
    );
  }, [navigation, getStatusColor, formatUsage, handleValveControl]);

  const renderGoalModal = useCallback(() => (
    <Modal
      visible={showGoalModal}
      transparent
      animationType="none"
      onRequestClose={() => setShowGoalModal(false)}
    >
      <View style={styles.modalOverlay}>
        <AnimatedView style={[styles.modalContent, modalAnimatedStyle]}>
          <LinearGradient
            colors={['#1F2937', '#111827']}
            style={styles.modalGradient}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Set Daily Goal</Text>
              <TouchableOpacity onPress={() => setShowGoalModal(false)}>
                <Ionicons name="close" size={24} color="#9ca3af" />
              </TouchableOpacity>
            </View>
            
            <TextInput
              style={styles.modalInput}
              value={tempGoal}
              onChangeText={setTempGoal}
              placeholder="Enter goal in liters"
              placeholderTextColor="#6B7280"
              keyboardType="numeric"
              autoFocus
            />
            
            <View style={styles.suggestedGoals}>
              {[3000, 5000, 7000, 10000].map((goal) => (
                <TouchableOpacity
                  key={goal}
                  style={[
                    styles.suggestedButton,
                    tempGoal === goal.toString() && styles.suggestedButtonActive
                  ]}
                  onPress={() => setTempGoal(goal.toString())}
                >
                  <Text style={[
                    styles.suggestedButtonText,
                    tempGoal === goal.toString() && styles.suggestedButtonTextActive
                  ]}>
                    {formatUsage(goal)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            
            <TouchableOpacity 
              style={styles.saveButton}
              onPress={handleSaveGoal}
            >
              <LinearGradient
                colors={['#06b6d4', '#0891b2']}
                style={styles.saveButtonGradient}
              >
                <Text style={styles.saveButtonText}>Save Goal</Text>
              </LinearGradient>
            </TouchableOpacity>
          </LinearGradient>
        </AnimatedView>
      </View>
    </Modal>
  ), [showGoalModal, tempGoal, handleSaveGoal, modalAnimatedStyle, formatUsage]);

  if (loading && user) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={['#030712', '#111827', '#000000']}
          style={[styles.gradient, { justifyContent: 'center', alignItems: 'center' }]}
        >
          <ActivityIndicator size="large" color="#06b6d4" />
          <Text style={styles.loadingText}>Loading your devices...</Text>
        </LinearGradient>
      </View>
    );
  }

  if (!user) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={['#030712', '#111827', '#000000']}
          style={[styles.gradient, { justifyContent: 'center', alignItems: 'center' }]}
        >
          <Ionicons name="lock-closed" size={60} color="#9ca3af" />
          <Text style={styles.notAuthTitle}>Authentication Required</Text>
          <Text style={styles.notAuthSubtitle}>
            Please sign in to access your water monitoring devices
          </Text>
        </LinearGradient>
      </View>
    );
  }

  const currentGradientColors = getUsageGradientColors();

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
            <View>
              <Text style={styles.greeting}>Hello,</Text>
              <Text style={styles.userName}>{userName}</Text>
            </View>
            
            <View style={styles.headerRightContainer}>
              {/* Alerts Button */}
              <TouchableOpacity 
                style={styles.alertsButton}
                onPress={handleAlertsPress}
              >
                <Ionicons name="notifications" size={24} color="#fff" />
                {unreadAlerts > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {unreadAlerts > 9 ? '9+' : unreadAlerts}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
              
              {/* Profile Button */}
              <TouchableOpacity 
                style={styles.profileButton}
                onPress={() => navigation.navigate('Profile')}
              >
                <LinearGradient
                  colors={['#F59E0B20', '#F59E0B20']}
                  style={styles.profileIconContainer}
                >
                  <Ionicons name="person" size={24} color="#F59E0B" />
                </LinearGradient>
              </TouchableOpacity>
            </View>
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
              tintColor="#06b6d4"
              colors={['#06b6d4']}
            />
          }
        >
          {/* Progress Circle */}
          <Animated.View style={[styles.progressContainer, pulseStyle]}>
            <View style={styles.progressGlow}>
              <Svg 
                width={CIRCLE_CONTAINER_SIZE} 
                height={CIRCLE_CONTAINER_SIZE} 
                viewBox={`0 0 ${CIRCLE_CONTAINER_SIZE} ${CIRCLE_CONTAINER_SIZE}`}
              >
                <Defs>
                  <SvgLinearGradient id="gradient" x1="0" y1="0" x2="0" y2="100%">
                    <Stop offset="0%" stopColor={currentGradientColors[0]} />
                    <Stop offset="50%" stopColor={currentGradientColors[1]} />
                    <Stop offset="100%" stopColor={currentGradientColors[2]} />
                  </SvgLinearGradient>
                </Defs>
                <Circle 
                  cx={CIRCLE_CONTAINER_SIZE/2} 
                  cy={CIRCLE_CONTAINER_SIZE/2} 
                  r={RADIUS} 
                  stroke="rgba(255, 255, 255, 0.06)" 
                  strokeWidth={STROKE_WIDTH} 
                  fill="none"
                />
                <AnimatedCircle 
                  cx={CIRCLE_CONTAINER_SIZE/2} 
                  cy={CIRCLE_CONTAINER_SIZE/2} 
                  r={RADIUS} 
                  stroke="url(#gradient)" 
                  strokeWidth={STROKE_WIDTH} 
                  strokeDasharray={CIRCUMFERENCE} 
                  animatedProps={animatedProps} 
                  strokeLinecap="round" 
                  rotation="-90" 
                  originX={CIRCLE_CONTAINER_SIZE/2} 
                  originY={CIRCLE_CONTAINER_SIZE/2}
                  fill="none"
                />
              </Svg>
            </View>
            <View style={styles.progressTextContainer}>
              <Text style={styles.progressValue}>{formatUsage(totalUsage)}</Text>
              <Text style={styles.progressLabel}>Today's Usage</Text>
              <TouchableOpacity onPress={handleGoalPress} style={styles.goalButton}>
                <Ionicons name="flag" size={14} color="#06b6d4" style={{ marginRight: 6 }} />
                <Text style={styles.goalText}>Goal: {formatUsage(dailyGoal)}</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>

          {/* Quick Actions */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Quick Actions</Text>
            <View style={styles.quickActionsGrid}>
              <TouchableOpacity
                style={styles.quickActionCard}
                onPress={() => handleQuickAction('addDevice')}
              >
                <LinearGradient
                  colors={['#10B98120', '#10B98110']}
                  style={styles.quickActionGradient}
                >
                  <Ionicons name="add-circle" size={32} color="#10B981" />
                  <Text style={styles.quickActionText}>Add Device</Text>
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickActionCard}
                onPress={() => handleQuickAction('analytics')}
              >
                <LinearGradient
                  colors={['#3B82F620', '#3B82F610']}
                  style={styles.quickActionGradient}
                >
                  <Ionicons name="analytics" size={32} color="#3B82F6" />
                  <Text style={styles.quickActionText}>Analytics</Text>
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickActionCard}
                onPress={() => handleQuickAction('settings')}
              >
                <LinearGradient
                  colors={['#8B5CF620', '#8B5CF610']}
                  style={styles.quickActionGradient}
                >
                  <Ionicons name="settings" size={32} color="#8B5CF6" />
                  <Text style={styles.quickActionText}>Settings</Text>
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickActionCard}
                onPress={() => handleQuickAction('status')}
              >
                <LinearGradient
                  colors={['#F59E0B20', '#F59E0B10']}
                  style={styles.quickActionGradient}
                >
                  <Ionicons name="pulse" size={32} color="#F59E0B" />
                  <Text style={styles.quickActionText}>Status</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
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
            
            {devices.length > 0 ? (
              devices.map((device, index) => renderDeviceCard(device, index))
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="water-outline" size={60} color="#37415180" />
                <Text style={styles.emptyStateText}>No Devices Connected</Text>
                <Text style={styles.emptyStateSubtext}>
                  Tap "Add Device" to get started
                </Text>
                <TouchableOpacity 
                  style={styles.addDeviceButton}
                  onPress={() => handleQuickAction('addDevice')}
                >
                  <LinearGradient
                    colors={['#06b6d4', '#0891b2']}
                    style={styles.addDeviceGradient}
                  >
                    <Ionicons name="add" size={20} color="#fff" />
                    <Text style={styles.addDeviceText}>Add Your First Device</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            )}
          </View>

          <View style={{ height: 100 }} />
        </ScrollView>
        
        {renderGoalModal()}
      </LinearGradient>
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
    paddingTop: 140,
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
  headerRightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  greeting: {
    fontSize: 16,
    color: '#ffffff',
    marginBottom: 4,
    fontWeight: '500',
  },
  userName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  alertsButton: {
    position: 'relative',
    padding: 8,
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#EF4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#111827',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
    paddingHorizontal: 4,
  },
  profileButton: {
    padding: 2,
  },
  profileIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F59E0B40',
  },
  
  // Progress Circle
  progressContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 30,
    height: CIRCLE_CONTAINER_SIZE,
  },
  progressGlow: {
    shadowColor: '#06b6d4',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  progressTextContainer: {
    position: 'absolute',
    alignItems: 'center',
  },
  progressValue: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 1,
  },
  progressLabel: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 8,
    fontWeight: '500',
  },
  goalButton: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#06b6d420',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#06b6d440',
    flexDirection: 'row',
    alignItems: 'center',
  },
  goalText: {
    fontSize: 13,
    color: '#06b6d4',
    fontWeight: '600',
  },
  
  // Section
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
  
  // Quick Actions
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  quickActionCard: {
    width: (width - 52) / 2,
    borderRadius: 16,
    overflow: 'hidden',
  },
  quickActionGradient: {
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#37415140',
    borderRadius: 16,
  },
  quickActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    marginTop: 8,
  },
  
  // Device Card
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
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 4,
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
  valveButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  
  // Empty State
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
  addDeviceButton: {
    marginTop: 20,
    borderRadius: 12,
    overflow: 'hidden',
  },
  addDeviceGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  addDeviceText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  
  // Loading/Auth States
  loadingText: {
    color: '#9ca3af',
    fontSize: 16,
    marginTop: 16,
  },
  notAuthTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 20,
    textAlign: 'center',
  },
  notAuthSubtitle: {
    fontSize: 16,
    color: '#9ca3af',
    marginTop: 10,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  
  // Modal Styles
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
  modalInput: {
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#374151',
    marginBottom: 16,
  },
  suggestedGoals: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  suggestedButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1f2937',
    borderWidth: 1,
    borderColor: '#374151',
  },
  suggestedButtonActive: {
    backgroundColor: '#06b6d420',
    borderColor: '#06b6d4',
  },
  suggestedButtonText: {
    fontSize: 14,
    color: '#9ca3af',
    fontWeight: '600',
  },
  suggestedButtonTextActive: {
    color: '#06b6d4',
  },
  saveButton: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  saveButtonGradient: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default HomeScreen;
    
