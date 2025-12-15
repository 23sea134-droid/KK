import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
  Linking,
  Dimensions,
  StatusBar,
  ActivityIndicator,
  Animated,
  Easing,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useDeviceData } from '../context/DeviceDataContext';
import { deviceService } from '../services/deviceService';
import { useFocusEffect } from '@react-navigation/native';
import { useTabBar } from '../context/TabBarContext';

const { width } = Dimensions.get('window');

// Water Flow Animation Component
const WaterFlowAnimation = ({ isFlowing }) => {
  const wave1 = useRef(new Animated.Value(0)).current;
  const wave2 = useRef(new Animated.Value(0)).current;
  const wave3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isFlowing) {
      const createWaveAnimation = (animatedValue, delay) => {
        return Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(animatedValue, {
              toValue: 1,
              duration: 2000,
              easing: Easing.ease,
              useNativeDriver: true,
            }),
            Animated.timing(animatedValue, {
              toValue: 0,
              duration: 0,
              useNativeDriver: true,
            }),
          ])
        );
      };

      const animations = Animated.parallel([
        createWaveAnimation(wave1, 0),
        createWaveAnimation(wave2, 400),
        createWaveAnimation(wave3, 800),
      ]);

      animations.start();

      return () => animations.stop();
    }
  }, [isFlowing, wave1, wave2, wave3]);

  const createWaveStyle = (animatedValue) => ({
    opacity: animatedValue.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0, 0.6, 0],
    }),
    transform: [
      {
        scale: animatedValue.interpolate({
          inputRange: [0, 1],
          outputRange: [0.5, 2],
        }),
      },
    ],
  });

  return (
    <View style={styles.waveContainer}>
      {isFlowing ? (
        <>
          <Animated.View style={[styles.wave, createWaveStyle(wave1)]} />
          <Animated.View style={[styles.wave, createWaveStyle(wave2)]} />
          <Animated.View style={[styles.wave, createWaveStyle(wave3)]} />
          <View style={styles.waveCenter}>
            <Ionicons name="water" size={24} color="#06b6d4" />
          </View>
        </>
      ) : (
        <View style={styles.waveCenter}>
          <Ionicons name="water-outline" size={24} color="#4B5563" />
        </View>
      )}
    </View>
  );
};

const StatusScreen = ({ navigation }) => {
  const { user } = useAuth();
  const { showTabBar } = useTabBar();
  
  // Use DeviceDataContext instead of managing own state
  const { 
    devices, 
    loading, 
    refreshDevices,
    totalDevices,
    onlineDevicesCount,
    offlineDevicesCount 
  } = useDeviceData();

  const [refreshing, setRefreshing] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [valveStates, setValveStates] = useState({});
  const [valveLoading, setValveLoading] = useState({});

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => showTabBar(), 100);
      return () => clearTimeout(timer);
    }, [showTabBar])
  );

  // Update valve states when devices change
  useEffect(() => {
    const updatedValveStates = {};
    devices.forEach(device => {
      if (device.data?.valveState !== undefined) {
        updatedValveStates[device.id] = device.data.valveState === 'OPEN';
      } else if (device.valveState !== undefined) {
        updatedValveStates[device.id] = device.valveState === 'OPEN';
      }
    });
    setValveStates(prev => ({ ...prev, ...updatedValveStates }));
  }, [devices]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshDevices();
    setRefreshing(false);
  }, [refreshDevices]);

  const toggleValve = useCallback(async (deviceId, deviceName, currentState, deviceStatus) => {
    if (!user?.uid) {
      Alert.alert('Error', 'User not authenticated');
      return;
    }

    if (valveLoading[deviceId]) {
      console.log('Valve operation already in progress for device:', deviceId);
      return;
    }

    if (deviceStatus?.toLowerCase() !== 'online') {
      Alert.alert(
        'Device Offline',
        'Cannot control valve. Device is currently offline.',
        [{ text: 'OK' }]
      );
      return;
    }

    const newState = !currentState;
    const action = newState ? 'open' : 'close';
    
    Alert.alert(
      `${action.charAt(0).toUpperCase() + action.slice(1)} Valve`,
      `Are you sure you want to ${action} the water valve for "${deviceName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action.charAt(0).toUpperCase() + action.slice(1),
          onPress: async () => {
            setValveLoading(prev => ({ ...prev, [deviceId]: true }));

            try {
              console.log(`🔧 Sending valve command: ${action} for device ${deviceId}`);
              
              const result = await deviceService.controlValve(deviceId, newState);
              
              if (result.success) {
                setValveStates(prev => ({ ...prev, [deviceId]: newState }));
                
                Alert.alert('Success', `Valve ${action}ed successfully. Changes will be reflected in a few seconds.`);
                
                console.log(`✅ Valve command sent successfully`);
                
                // The DeviceDataContext will automatically update via real-time listeners
                // No need to manually refresh
              } else {
                console.error('❌ Valve control failed:', result.error);
                Alert.alert('Error', result.error || `Failed to ${action} valve`);
                
                setValveStates(prev => ({ ...prev, [deviceId]: currentState }));
              }
            } catch (error) {
              console.error('❌ Valve control error:', error);
              Alert.alert('Error', `Failed to ${action} valve. Please try again.`);
              
              setValveStates(prev => ({ ...prev, [deviceId]: currentState }));
            } finally {
              setValveLoading(prev => ({ ...prev, [deviceId]: false }));
            }
          }
        }
      ]
    );
  }, [user?.uid, valveLoading]);

  const getStatusInfo = useCallback((status) => {
    switch (status?.toLowerCase()) {
      case 'online':
        return { color: '#10B981', icon: 'checkmark-circle', text: 'Online' };
      case 'offline':
        return { color: '#EF4444', icon: 'close-circle', text: 'Offline' };
      case 'warning':
        return { color: '#F59E0B', icon: 'warning', text: 'Warning' };
      case 'maintenance':
        return { color: '#8B5CF6', icon: 'construct', text: 'Maintenance' };
      default:
        return { color: '#6B7280', icon: 'help-circle', text: 'Unknown' };
    }
  }, []);

  const getFilteredDevices = useCallback(() => {
    if (selectedFilter === 'all') return devices;
    return devices.filter(device => device.status?.toLowerCase() === selectedFilter);
  }, [devices, selectedFilter]);

  const formatLastSeen = useCallback((timestamp) => {
    if (!timestamp) return 'Never';
    
    const now = new Date();
    const lastSeen = new Date(timestamp);
    const diffInMinutes = Math.floor((now - lastSeen) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays}d ago`;
  }, []);

  const openLocationInMaps = useCallback((latitude, longitude) => {
    if (!latitude || !longitude) {
      Alert.alert('Invalid Location', 'GPS coordinates are not available.');
      return;
    }
    const url = `https://maps.google.com/?q=${latitude},${longitude}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'Unable to open maps application');
    });
  }, []);

  const handleDeviceAction = useCallback((device) => {
    const actions = [
      { 
        text: 'View Details', 
        onPress: () => navigation.navigate('DeviceDetail', { deviceId: device.id })
      },
    ];

    if (device.gpsLocation?.latitude && device.gpsLocation?.longitude) {
      actions.push({
        text: 'View Location',
        onPress: () => openLocationInMaps(
          device.gpsLocation.latitude,
          device.gpsLocation.longitude
        )
      });
    }

    actions.push({ text: 'Cancel', style: 'cancel' });

    Alert.alert(device.name || 'Device Options', 'Choose an action:', actions);
  }, [navigation, openLocationInMaps]);

  const renderDeviceCard = useCallback((device, index) => {
    const statusInfo = getStatusInfo(device.status);
    const isValveOpen = valveStates[device.id] ?? (device.data?.valveState === 'OPEN') ?? (device.valveState === 'OPEN');
    const isValveLoading = valveLoading[device.id] || false;
    const flowRate = device.data?.flowRate || device.flowRate || 0;
    const totalLitres = device.data?.totalLitres || device.totalUsage || device.totalLitres || 0;
    const batteryLevel = device.data?.batteryPercentage || device.batteryLevel || device.batteryPercentage || 0;
    const isOnline = device.status?.toLowerCase() === 'online';
    const actualDeviceId = device.deviceId || device.id;
    
    const getBatteryIcon = () => {
      if (batteryLevel > 75) return 'battery-full';
      if (batteryLevel > 25) return 'battery-half';
      return 'battery-dead';
    };
    
    const getBatteryColor = () => {
      if (batteryLevel > 75) return '#10B981';
      if (batteryLevel > 25) return '#F59E0B';
      return '#EF4444';
    };
    
    return (
      <TouchableOpacity
        key={device.id || device.deviceId || index}
        style={styles.deviceCard}
        onPress={() => handleDeviceAction(device)}
        activeOpacity={0.9}
      >
        <LinearGradient
          colors={['#1A1F2E', '#151920']}
          style={styles.cardGradient}
        >
          {/* Header Row: Device Name + Status */}
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <Ionicons name="water" size={20} color="#06b6d4" />
              <Text style={styles.cardDeviceName} numberOfLines={1}>
                {device.name || `Water Monitor ${index + 1}`}
              </Text>
            </View>
            
            <View style={styles.statusContainer}>
              <View style={[styles.statusDot, { backgroundColor: statusInfo.color }]} />
              <Text style={[styles.statusLabel, { color: statusInfo.color }]}>
                {statusInfo.text}
              </Text>
            </View>
          </View>

          {/* Battery Row */}
          <View style={styles.batteryRow}>
            <Ionicons 
              name={getBatteryIcon()} 
              size={18} 
              color={getBatteryColor()} 
            />
            <Text style={[styles.batteryText, { color: getBatteryColor() }]}>
              {batteryLevel}%
            </Text>
          </View>

          {/* Valve Control */}
          <View style={styles.valveSection}>
            <Text style={styles.valveSectionLabel}>Water Valve Control</Text>
            
            <View style={styles.valveToggleContainer}>
              <Text style={styles.valveStateText}>
                {isValveLoading ? 'UPDATING...' : (isValveOpen ? 'OPEN' : 'CLOSED')}
              </Text>
              
              <TouchableOpacity
                onPress={() => toggleValve(actualDeviceId, device.name, isValveOpen, device.status)}
                disabled={isValveLoading || !isOnline}
                activeOpacity={0.7}
                style={styles.toggleWrapper}
              >
                <View style={[
                  styles.toggleContainer,
                  isValveOpen && styles.toggleContainerActive,
                  !isOnline && styles.toggleContainerDisabled
                ]}>
                  <View style={[
                    styles.toggleCircle,
                    isValveOpen && styles.toggleCircleActive
                  ]}>
                    {isValveLoading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Ionicons 
                        name={isValveOpen ? "checkmark" : "close"} 
                        size={16} 
                        color="#fff" 
                      />
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            </View>

            {!isOnline && (
              <View style={styles.offlineWarning}>
                <Ionicons name="alert-circle" size={14} color="#F59E0B" />
                <Text style={styles.offlineWarningText}>Device offline - Cannot control valve</Text>
              </View>
            )}
          </View>

          {/* Water Flow Indicator */}
          <View style={styles.flowSection}>
            <WaterFlowAnimation isFlowing={isOnline && flowRate > 0} />
            
            <View style={styles.flowStats}>
              <View style={styles.flowStatItem}>
                <Ionicons name="speedometer-outline" size={16} color="#06b6d4" />
                <Text style={styles.flowStatLabel}>Flow Rate</Text>
                <Text style={styles.flowStatValue}>
                  {flowRate > 0 ? `${flowRate.toFixed(1)} L/min` : '0.0 L/min'}
                </Text>
              </View>
              
              <View style={styles.flowDivider} />
              
              <View style={styles.flowStatItem}>
                <Ionicons name="water-outline" size={16} color="#10B981" />
                <Text style={styles.flowStatLabel}>Total Usage</Text>
                <Text style={styles.flowStatValue}>
                  {totalLitres >= 1000 
                    ? `${(totalLitres / 1000).toFixed(2)} m³`
                    : `${totalLitres.toFixed(0)} L`
                  }
                </Text>
              </View>
            </View>
          </View>
        </LinearGradient>
      </TouchableOpacity>
    );
  }, [getStatusInfo, handleDeviceAction, valveStates, valveLoading, toggleValve]);

  if (loading && user) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={['#030712', '#111827', '#000000']}
          style={[styles.gradient, { justifyContent: 'center', alignItems: 'center' }]}
        >
          <ActivityIndicator size="large" color="#06b6d4" />
          <Text style={styles.loadingText}>Loading device status...</Text>
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
            Please sign in to view device status
          </Text>
        </LinearGradient>
      </View>
    );
  }

  const filteredDevices = getFilteredDevices();
  const statusCounts = {
    all: totalDevices,
    online: onlineDevicesCount,
    offline: offlineDevicesCount,
    warning: devices.filter(d => d.status?.toLowerCase() === 'warning').length,
  };

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
              <Text style={styles.headerTitle}>Device Status</Text>
              <Text style={styles.headerSubtitle}>
                {totalDevices} device{totalDevices !== 1 ? 's' : ''} connected
              </Text>
            </View>
            
            {/* Real-time Mode Indicator (Always Active) */}
            <LinearGradient
              colors={['#10B98120', '#10B98110']}
              style={styles.modeCard}
            >
              <Ionicons 
                name="flash" 
                size={20} 
                color="#10B981" 
              />
              <Text style={[styles.modeText, { color: "#10B981" }]}>
                Real-time
              </Text>
            </LinearGradient>
          </View>
        </LinearGradient>
      </View>

      {/* Scrollable Content */}
      <LinearGradient
        colors={['#030712', '#111827', '#000000']}
        style={styles.gradient}
      >
        <ScrollView 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl 
              refreshing={refreshing} 
              onRefresh={onRefresh} 
              tintColor="#06b6d4"
              colors={['#06b6d4']}
            />
          }
        >
          {/* Filter Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Filter by Status</Text>
            <View style={styles.filtersGrid}>
              {[
                { key: 'all', label: 'All', icon: 'apps', color: '#3B82F6' },
                { key: 'online', label: 'Online', icon: 'checkmark-circle', color: '#10B981' },
                { key: 'offline', label: 'Offline', icon: 'close-circle', color: '#EF4444' },
                { key: 'warning', label: 'Warning', icon: 'warning', color: '#F59E0B' },
              ].map((filter) => (
                <TouchableOpacity
                  key={filter.key}
                  style={[
                    styles.filterCard,
                    selectedFilter === filter.key && styles.filterCardActive
                  ]}
                  onPress={() => setSelectedFilter(filter.key)}
                  activeOpacity={0.7}
                >
                  <LinearGradient
                    colors={
                      selectedFilter === filter.key 
                        ? [`${filter.color}20`, `${filter.color}10`]
                        : ['#1f293780', '#11182780']
                    }
                    style={styles.filterGradient}
                  >
                    <View style={[styles.filterIcon, { backgroundColor: filter.color }]}>
                      <Ionicons name={filter.icon} size={20} color="#fff" />
                    </View>
                    <Text style={[
                      styles.filterCount,
                      selectedFilter === filter.key && styles.filterTextActive
                    ]}>
                      {statusCounts[filter.key]}
                    </Text>
                    <Text style={[
                      styles.filterLabel,
                      selectedFilter === filter.key && styles.filterTextActive
                    ]}>
                      {filter.label}
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Devices Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                {selectedFilter === 'all' ? 'All Devices' : `${selectedFilter.charAt(0).toUpperCase() + selectedFilter.slice(1)} Devices`}
              </Text>
              {filteredDevices.length > 0 && (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{filteredDevices.length}</Text>
                </View>
              )}
            </View>
            
            {filteredDevices.length > 0 ? (
              filteredDevices.map((device, index) => renderDeviceCard(device, index))
            ) : (
              <View style={styles.emptyState}>
                <Ionicons 
                  name={selectedFilter === 'all' ? 'water-outline' : 'search-outline'} 
                  size={60} 
                  color="#37415180" 
                />
                <Text style={styles.emptyStateText}>
                  {selectedFilter === 'all' ? 'No Devices Connected' : `No ${selectedFilter} Devices`}
                </Text>
                <Text style={styles.emptyStateSubtext}>
                  {selectedFilter === 'all' 
                    ? 'Tap "Add Device" to get started'
                    : `No devices with ${selectedFilter} status found`
                  }
                </Text>
                {selectedFilter === 'all' && (
                  <TouchableOpacity 
                    style={styles.addButton}
                    onPress={() => navigation.navigate('QRScan')}
                  >
                    <LinearGradient
                      colors={['#06b6d4', '#0891b2']}
                      style={styles.addButtonGradient}
                    >
                      <Ionicons name="qr-code" size={20} color="#fff" />
                      <Text style={styles.addButtonText}>Add Your First Device</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>

          <View style={{ height: 100 }} />
        </ScrollView>
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
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
  },
  // Real-time Mode Card
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#37415140',
  },
  modeText: {
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 8,
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
  countBadge: {
    backgroundColor: '#06b6d420',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#06b6d440',
  },
  countBadgeText: {
    fontSize: 12,
    color: '#06b6d4',
    fontWeight: '600',
  },
  // Filters
  filtersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  filterCard: {
    width: (width - 52) / 2,
    borderRadius: 16,
    overflow: 'hidden',
  },
  filterCardActive: {
    shadowColor: '#06b6d4',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  filterGradient: {
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#37415140',
    borderRadius: 16,
  },
  filterIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  filterCount: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  filterLabel: {
    fontSize: 12,
    color: '#9ca3af',
    fontWeight: '600',
  },
  filterTextActive: {
    color: '#fff',
  },
  // New Modern Device Card Styles
  deviceCard: {
    marginBottom: 16,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  cardGradient: {
    padding: 20,
    borderWidth: 1,
    borderColor: '#2A3441',
    borderRadius: 20,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  cardDeviceName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    flex: 1,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1F2937',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  batteryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    backgroundColor: '#1F2937',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 6,
    marginBottom: 16,
  },
  batteryText: {
    fontSize: 14,
    fontWeight: '700',
  },
  valveSection: {
    backgroundColor: '#1F2937',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#374151',
  },
  valveSectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  valveToggleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  valveStateText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 1,
  },
  toggleWrapper: {
    padding: 4,
  },
  toggleContainer: {
    width: 64,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EF4444',
    padding: 2,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  toggleContainerActive: {
    backgroundColor: '#10B981',
  },
  toggleContainerDisabled: {
    backgroundColor: '#4B5563',
    opacity: 0.5,
  },
  toggleCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
  toggleCircleActive: {
    alignSelf: 'flex-end',
  },
  offlineWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#F59E0B20',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F59E0B40',
    gap: 8,
  },
  offlineWarningText: {
    fontSize: 11,
    color: '#F59E0B',
    fontWeight: '600',
    flex: 1,
  },
  flowSection: {
    backgroundColor: '#1F2937',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#374151',
  },
  waveContainer: {
    width: 80,
    height: 80,
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  wave: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#06b6d4',
    borderWidth: 2,
    borderColor: '#06b6d4',
  },
  waveCenter: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#111827',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#374151',
    zIndex: 10,
  },
  flowStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  flowStatItem: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  flowStatLabel: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  flowStatValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  flowDivider: {
    width: 1,
    backgroundColor: '#374151',
    marginHorizontal: 16,
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
  addButton: {
    marginTop: 20,
    borderRadius: 12,
    overflow: 'hidden',
  },
  addButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  // Loading States
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
});

export default StatusScreen;
