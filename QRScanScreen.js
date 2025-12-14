import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TouchableOpacity,
  Dimensions,
  Modal,
  TextInput,
  AppState,
  ScrollView,
  StatusBar,
  Platform,
  Vibration,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, Camera } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useAuth } from '../context/AuthContext';
import { deviceService } from '../services/deviceService';
import { useTabBar } from '../context/TabBarContext';
import { useFocusEffect } from '@react-navigation/native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { getDatabase, ref, get } from 'firebase/database';

const AnimatedView = Animated.createAnimatedComponent(View);
const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

const { width, height } = Dimensions.get('window');
const SAFE_AREA_TOP = Platform.OS === 'ios' ? 44 : StatusBar.currentHeight || 0;
const SAFE_AREA_BOTTOM = Platform.OS === 'ios' ? 34 : 0;

const QRScanScreen = ({ navigation }) => {
  const { user } = useAuth();
  const { hideTabBar, showTabBar } = useTabBar();
  
  // Core camera state
  const [hasPermission, setHasPermission] = useState(null);
  const [scanned, setScanned] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Modal state
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualDeviceId, setManualDeviceId] = useState('');
  const [deviceName, setDeviceName] = useState('Water Monitor');
  const [deviceLocation, setDeviceLocation] = useState('Home');
  
  // Form validation
  const [errors, setErrors] = useState({});
  
  // Animation values
  const cornerPulse = useSharedValue(1);
  const manualModalScale = useSharedValue(0);

  // Refs for cleanup
  const isMountedRef = useRef(true);
  const scanTimeoutRef = useRef(null);
  const flashTimeoutRef = useRef(null);
  const lastScanTime = useRef(0);
  const isScreenFocused = useRef(false);
  const tabBarHideIntervalRef = useRef(null);

  // Modal animations
  useEffect(() => {
    if (showManualEntry) {
      manualModalScale.value = withSpring(1, { damping: 12, stiffness: 400, mass: 0.5 });
    } else {
      manualModalScale.value = withTiming(0, { duration: 150, easing: Easing.in(Easing.ease) });
    }
  }, [showManualEntry]);

  const manualModalAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: manualModalScale.value }],
    opacity: manualModalScale.value,
  }));

  // ====================
  // ANIMATIONS
  // ====================
  useEffect(() => {
    cornerPulse.value = withRepeat(
      withSequence(
        withTiming(1.15, { duration: 1000, easing: Easing.bezier(0.4, 0.0, 0.2, 1) }),
        withTiming(1, { duration: 1000, easing: Easing.bezier(0.4, 0.0, 0.2, 1) })
      ),
      -1,
      false
    );
  }, []);

  // ====================
  // TAB BAR MANAGEMENT
  // ====================
  const ensureTabBarHidden = useCallback(() => {
    if (isScreenFocused.current) {
      hideTabBar();
    }
  }, [hideTabBar]);

  useFocusEffect(
    useCallback(() => {
      isScreenFocused.current = true;
      hideTabBar();
      setIsCameraActive(true);
      
      tabBarHideIntervalRef.current = setInterval(() => {
        ensureTabBarHidden();
      }, 100);
      
      return () => {
        isScreenFocused.current = false;
        setIsCameraActive(false);
        setFlashOn(false);
        
        if (tabBarHideIntervalRef.current) {
          clearInterval(tabBarHideIntervalRef.current);
          tabBarHideIntervalRef.current = null;
        }
        
        setTimeout(() => {
          if (!isScreenFocused.current) {
            showTabBar();
          }
        }, 50);
      };
    }, [hideTabBar, showTabBar, ensureTabBarHidden])
  );

  useEffect(() => {
    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === 'active' && isScreenFocused.current) {
        setIsCameraActive(true);
        setTimeout(() => ensureTabBarHidden(), 100);
      } else {
        setIsCameraActive(false);
        setFlashOn(false);
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  }, [ensureTabBarHidden]);

  // ====================
  // COMPONENT LIFECYCLE
  // ====================
  useEffect(() => {
    isMountedRef.current = true;
    
    if (Platform.OS === 'android') {
      StatusBar.setBackgroundColor('rgba(0,0,0,0.3)', true);
      StatusBar.setTranslucent(true);
    }
    StatusBar.setBarStyle('light-content', true);
    
    setTimeout(() => ensureTabBarHidden(), 50);
    
    return () => {
      isMountedRef.current = false;
      
      [scanTimeoutRef, flashTimeoutRef, tabBarHideIntervalRef].forEach(ref => {
        if (ref.current) {
          clearTimeout(ref.current);
          clearInterval(ref.current);
        }
      });
      
      if (Platform.OS === 'android') {
        StatusBar.setBackgroundColor('#030712', true);
        StatusBar.setTranslucent(false);
      }
    };
  }, [ensureTabBarHidden]);

  // ====================
  // CAMERA PERMISSIONS
  // ====================
  const getCameraPermissions = useCallback(async () => {
    try {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
      setTimeout(() => ensureTabBarHidden(), 100);
    } catch (error) {
      console.error('Camera permission error:', error);
      setHasPermission(false);
    }
  }, [ensureTabBarHidden]);

  useEffect(() => {
    getCameraPermissions();
  }, [getCameraPermissions]);

  // ====================
  // RESET SCAN STATE
  // ====================
  const resetScanState = useCallback(() => {
    if (isMountedRef.current) {
      setScanned(false);
      setIsProcessing(false);
    }
  }, []);

  // ====================
  // ADD DEVICE TO ACCOUNT
  // ====================
  const addDeviceToAccount = useCallback(async (deviceId, deviceKey = null) => {
    if (!user?.uid) {
      Alert.alert('Error', 'User not authenticated');
      return false;
    }

    try {
      console.log('📱 Adding device to account...');
      
      const deviceData = {
        deviceId: deviceId,
        name: deviceName.trim() || 'Water Monitor',
        location: deviceLocation.trim() || 'Home',
        deviceKey: deviceKey,
        status: 'offline',
        valveStatus: 'open',
        batteryLevel: 100,
        signalStrength: 'Unknown',
        totalUsage: 0,
        lastSeen: new Date().toISOString(),
        userId: user.uid,
        addedAt: Date.now(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        type: 'Water Flow Sensor'
      };

      const addResult = await deviceService.addDevice(user.uid, deviceData);
      
      if (!addResult?.success) {
        if (addResult?.isDuplicate) {
          console.log('⚠️ Device already exists in user list');
          return true;
        } else {
          throw new Error(addResult?.error || 'Failed to add device');
        }
      }

      console.log('✅ Device added successfully');
      
      // Claim device ownership
      const ownershipResult = await deviceService.claimDeviceOwnership(user.uid, deviceId);
      if (ownershipResult.success) {
        console.log('✅ Device ownership claimed');
      } else {
        console.warn('⚠️ Failed to claim ownership:', ownershipResult.error);
      }
      
      return true;
    } catch (error) {
      console.error('❌ Error adding device:', error);
      throw error;
    }
  }, [user?.uid, deviceName, deviceLocation]);

  // ====================
  // QR SCAN HANDLING
  // ====================
  const handleBarcodeScanned = useCallback(async ({ type, data }) => {
    const now = Date.now();
    
    if (scanned || !isMountedRef.current || isProcessing || now - lastScanTime.current < 2000) {
      return;
    }
    
    if (Platform.OS === 'ios') {
      Vibration.vibrate([100]);
    } else {
      Vibration.vibrate(100);
    }
    
    setScanned(true);
    setIsProcessing(true);
    setFlashOn(false);
    lastScanTime.current = now;
    
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
    }
    
    try {
      let deviceData;
      
      try {
        deviceData = JSON.parse(data);
      } catch (parseError) {
        const trimmedData = data.trim();
        if (trimmedData) {
          deviceData = { deviceId: trimmedData };
        } else {
          throw new Error('Empty QR code');
        }
      }
      
      if (!deviceData?.deviceId) {
        Alert.alert(
          'Invalid QR Code',
          'This QR code does not contain valid device information.',
          [{ text: 'OK', onPress: resetScanState }]
        );
        return;
      }

      const deviceId = deviceData.deviceId;

      // ✅ NEW: Check if device is already claimed by another user
      const database = getDatabase();
      const ownerRef = ref(database, `deviceOwners/${deviceId}`);
      const ownerSnap = await get(ownerRef);
      
      if (ownerSnap.exists()) {
        const currentOwner = ownerSnap.val();
        if (currentOwner !== user.uid) {
          setIsProcessing(false);
          Alert.alert(
            'Device Already Claimed',
            'This device is already registered to another user account.',
            [{ text: 'OK', onPress: resetScanState }]
          );
          return;
        }
        
        // User already owns this device
        setIsProcessing(false);
        Alert.alert(
          'Device Already Connected',
          'This device is already connected to your account.',
          [
            {
              text: 'View Devices',
              onPress: () => {
                resetScanState();
                isScreenFocused.current = false;
                if (tabBarHideIntervalRef.current) {
                  clearInterval(tabBarHideIntervalRef.current);
                  tabBarHideIntervalRef.current = null;
                }
                showTabBar();
                navigation.navigate('Home');
              }
            },
            {
              text: 'OK',
              onPress: resetScanState
            }
          ]
        );
        return;
      }
      
      // Device is unclaimed - proceed to add
      try {
        const added = await addDeviceToAccount(deviceId, deviceData.deviceKey || null);
        
        if (added) {
          Alert.alert(
            'Device Added Successfully',
            `Device ID: ${deviceId}\n\nDevice has been added to your account.`,
            [
              {
                text: 'View Devices',
                onPress: () => {
                  resetScanState();
                  isScreenFocused.current = false;
                  if (tabBarHideIntervalRef.current) {
                    clearInterval(tabBarHideIntervalRef.current);
                    tabBarHideIntervalRef.current = null;
                  }
                  showTabBar();
                  navigation.navigate('Home');
                }
              },
              {
                text: 'Scan Another',
                onPress: () => {
                  handleScanAgain();
                }
              }
            ]
          );
        }
      } catch (error) {
        console.error('❌ Error adding device from QR:', error);
        Alert.alert(
          'Setup Error',
          error.message || 'Failed to add device',
          [{ text: 'OK', onPress: resetScanState }]
        );
      }
      
    } catch (error) {
      console.error('❌ QR scan error:', error);
      Alert.alert(
        'Invalid QR Code',
        'Unable to read device information from this QR code.',
        [{ text: 'OK', onPress: resetScanState }]
      );
    }
  }, [scanned, isProcessing, resetScanState, addDeviceToAccount, navigation, showTabBar, user, handleScanAgain]);

  // ====================
  // MANUAL ENTRY HANDLING
  // ====================
  const validateForm = useCallback(() => {
    const newErrors = {};
    
    const trimmedDeviceId = manualDeviceId.trim();
    if (!trimmedDeviceId) {
      newErrors.deviceId = 'Device ID is required';
    } else if (trimmedDeviceId.length < 3) {
      newErrors.deviceId = 'Device ID must be at least 3 characters';
    } else if (trimmedDeviceId.length > 50) {
      newErrors.deviceId = 'Device ID must be less than 50 characters';
    }
    
    if (deviceName.trim().length > 50) {
      newErrors.deviceName = 'Device name must be less than 50 characters';
    }
    
    if (deviceLocation.trim().length > 100) {
      newErrors.deviceLocation = 'Location must be less than 100 characters';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [manualDeviceId, deviceName, deviceLocation]);

  const handleManualEntry = useCallback(async () => {
    if (!validateForm()) {
      return;
    }

    const trimmedId = manualDeviceId.trim();
    if (!trimmedId) {
      Alert.alert('Error', 'Please enter a valid device ID');
      return;
    }

    try {
      setIsProcessing(true);
      
      // ✅ CHECK: Is device already claimed by someone else?
      const database = getDatabase();
      const ownerRef = ref(database, `deviceOwners/${trimmedId}`);
      const ownerSnap = await get(ownerRef);
      
      if (ownerSnap.exists()) {
        const currentOwner = ownerSnap.val();
        if (currentOwner !== user.uid) {
          setIsProcessing(false);
          setShowManualEntry(false);
          Alert.alert(
            'Device Already Claimed',
            'This device is already registered to another user account.',
            [{ text: 'OK', onPress: resetScanState }]
          );
          return;
        }
        
        // User already owns this device
        setIsProcessing(false);
        setShowManualEntry(false);
        Alert.alert(
          'Device Already Connected',
          'This device is already connected to your account.',
          [
            {
              text: 'View Devices',
              onPress: () => {
                isScreenFocused.current = false;
                if (tabBarHideIntervalRef.current) {
                  clearInterval(tabBarHideIntervalRef.current);
                  tabBarHideIntervalRef.current = null;
                }
                showTabBar();
                navigation.navigate('Home');
              }
            },
            {
              text: 'OK',
              onPress: resetScanState
            }
          ]
        );
        return;
      }
      
      // Device is unclaimed - proceed to add
      const added = await addDeviceToAccount(trimmedId, null);
      
      if (added) {
        setShowManualEntry(false);
        
        Alert.alert(
          'Device Added Successfully',
          `Device ID: ${trimmedId}\n\nDevice has been added to your account.`,
          [
            {
              text: 'View Devices',
              onPress: () => {
                isScreenFocused.current = false;
                if (tabBarHideIntervalRef.current) {
                  clearInterval(tabBarHideIntervalRef.current);
                  tabBarHideIntervalRef.current = null;
                }
                showTabBar();
                navigation.navigate('Home');
              }
            },
            {
              text: 'Scan Another',
              onPress: () => {
                handleScanAgain();
              }
            }
          ]
        );
      }
    } catch (error) {
      console.error('❌ Manual entry error:', error);
      Alert.alert('Error', error.message || 'Failed to add device. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  }, [manualDeviceId, validateForm, addDeviceToAccount, navigation, showTabBar, handleScanAgain, resetScanState, user]);

  const openManualEntry = useCallback(() => {
    setIsCameraActive(false);
    setFlashOn(false);
    setScanned(false);
    setIsProcessing(false);
    setErrors({});
    setShowManualEntry(true);
    ensureTabBarHidden();
  }, [ensureTabBarHidden]);

  const closeManualEntry = useCallback(() => {
    setShowManualEntry(false);
    setManualDeviceId('');
    setErrors({});
    resetScanState();
    
    setTimeout(() => {
      if (isMountedRef.current && isScreenFocused.current) {
        setIsCameraActive(true);
        ensureTabBarHidden();
      }
    }, 100);
  }, [resetScanState, ensureTabBarHidden]);

  // ====================
  // UI HANDLERS
  // ====================
  const toggleFlash = useCallback(() => {
    if (!isCameraActive || showManualEntry) return;
    setFlashOn(prev => !prev);
  }, [isCameraActive, showManualEntry]);

  const handleGoBack = useCallback(() => {
    setIsCameraActive(false);
    setFlashOn(false);
    setShowManualEntry(false);
    isScreenFocused.current = false;
    
    if (tabBarHideIntervalRef.current) {
      clearInterval(tabBarHideIntervalRef.current);
      tabBarHideIntervalRef.current = null;
    }
    
    showTabBar();
    navigation.goBack();
  }, [navigation, showTabBar]);

  const handleScanAgain = useCallback(() => {
    resetScanState();
    if (isScreenFocused.current) {
      setIsCameraActive(true);
      ensureTabBarHidden();
    }
  }, [resetScanState, ensureTabBarHidden]);

  const cornerPulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cornerPulse.value }],
  }));

  // ====================
  // RENDER CONDITIONS
  // ====================
  if (!user) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
        <LinearGradient colors={['#030712', '#111827', '#000000']} style={styles.fullScreen}>
          <SafeAreaView style={styles.safeArea} edges={['top']}>
            <View style={styles.header}>
              <TouchableOpacity
                style={styles.headerButton}
                onPress={handleGoBack}
                activeOpacity={0.7}
              >
                <LinearGradient
                  colors={['#06b6d420', '#0891b220']}
                  style={styles.headerButtonGradient}
                >
                  <Ionicons name="arrow-back" size={24} color="#06b6d4" />
                </LinearGradient>
              </TouchableOpacity>
            </View>

            <View style={styles.centerContent}>
              <View style={styles.iconContainer}>
                <Ionicons name="camera" size={64} color="#9ca3af" />
              </View>
              <Text style={styles.title}>Authentication Required</Text>
              <Text style={styles.subtitle}>
                Please sign in to scan QR codes and add devices
              </Text>
            </View>
          </SafeAreaView>
        </LinearGradient>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
        <LinearGradient colors={['#030712', '#111827', '#000000']} style={styles.fullScreen}>
          <SafeAreaView style={styles.safeArea} edges={['top']}>
            <View style={styles.header}>
              <TouchableOpacity
                style={styles.headerButton}
                onPress={handleGoBack}
                activeOpacity={0.7}
              >
                <LinearGradient
                  colors={['#06b6d420', '#0891b220']}
                  style={styles.headerButtonGradient}
                >
                  <Ionicons name="arrow-back" size={24} color="#06b6d4" />
                </LinearGradient>
              </TouchableOpacity>
            </View>

            <View style={styles.centerContent}>
              <View style={styles.iconContainer}>
                <Ionicons name="camera-off" size={64} color="#9ca3af" />
              </View>
              <Text style={styles.title}>Camera Access Required</Text>
              <Text style={styles.subtitle}>
                Please allow camera access to scan QR codes
              </Text>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={getCameraPermissions}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={['#06b6d4', '#0891b2']}
                  style={styles.buttonGradient}
                >
                  <Text style={styles.buttonText}>Grant Permission</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </LinearGradient>
      </View>
    );
  }

  const shouldShowCamera = isCameraActive && !showManualEntry && hasPermission;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="rgba(0,0,0,0.3)" translucent />
      
      {/* Camera View */}
      {shouldShowCamera && (
        <CameraView
          style={styles.camera}
          facing="back"
          enableTorch={flashOn}
          onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
          barcodeScannerSettings={{
            barcodeTypes: ['qr', 'code128', 'code39', 'ean13', 'ean8', 'upc_e'],
          }}
        />
      )}

      {/* Header Overlay */}
      {shouldShowCamera && (
        <BlurView intensity={90} tint="dark" style={styles.headerOverlay}>
          <TouchableOpacity
            style={styles.cameraHeaderButton}
            onPress={handleGoBack}
            activeOpacity={0.7}
          >
            <LinearGradient
              colors={['#06b6d420', '#0891b220']}
              style={styles.cameraButtonGradient}
            >
              <Ionicons name="arrow-back" size={24} color="#06b6d4" />
            </LinearGradient>
          </TouchableOpacity>
          
          <Text style={styles.headerTitle}>Scan QR Code</Text>
          
          <TouchableOpacity
            style={styles.cameraHeaderButton}
            onPress={toggleFlash}
            activeOpacity={0.7}
          >
            <LinearGradient
              colors={flashOn ? 
                ['#F59E0B20', '#D9770620'] :
                ['#06b6d420', '#0891b220']}
              style={styles.cameraButtonGradient}
            >
              <Ionicons 
                name={flashOn ? "flash-off" : "flash"} 
                size={24} 
                color={flashOn ? "#F59E0B" : "#06b6d4"} 
              />
            </LinearGradient>
          </TouchableOpacity>
        </BlurView>
      )}

      {/* Scanning Frame */}
      {shouldShowCamera && (
        <View style={styles.scanFrameContainer}>
          <View style={styles.scanFrame}>
            <AnimatedView style={[styles.corner, styles.topLeft, cornerPulseStyle]} />
            <AnimatedView style={[styles.corner, styles.topRight, cornerPulseStyle]} />
            <AnimatedView style={[styles.corner, styles.bottomLeft, cornerPulseStyle]} />
            <AnimatedView style={[styles.corner, styles.bottomRight, cornerPulseStyle]} />
            
            {isProcessing && (
              <BlurView intensity={90} tint="dark" style={styles.processingOverlay}>
                <View style={styles.processingContent}>
                  <View style={styles.successBadge}>
                    <Ionicons name="checkmark-circle" size={56} color="#10B981" />
                  </View>
                  <Text style={styles.processingText}>Processing...</Text>
                </View>
              </BlurView>
            )}
          </View>
        </View>
      )}

      {/* Instructions */}
      {shouldShowCamera && !scanned && !isProcessing && (
        <View style={styles.instructions}>
          <BlurView intensity={70} tint="dark" style={styles.instructionsContent}>
            <Text style={styles.instructionText}>
              Position the QR code within the frame
            </Text>
          </BlurView>
        </View>
      )}

      {/* Bottom Actions */}
      {shouldShowCamera && (
        <BlurView intensity={90} tint="dark" style={styles.bottomActionsBlur}>
          <View style={styles.bottomActions}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={openManualEntry}
              activeOpacity={0.8}
              disabled={isProcessing}
            >
              <LinearGradient
                colors={['#1f293780', '#11182780']}
                style={styles.actionButtonContent}
              >
                <View style={styles.actionIconBox}>
                  <Ionicons name="keypad" size={22} color="#06b6d4" />
                </View>
                <Text style={styles.actionButtonText}>Manual Entry</Text>
              </LinearGradient>
            </TouchableOpacity>
            
            {scanned && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={handleScanAgain}
                activeOpacity={0.8}
                disabled={isProcessing}
              >
                <LinearGradient
                  colors={['#06b6d4', '#0891b2']}
                  style={styles.actionButtonContent}
                >
                  <View style={[styles.actionIconBox, { backgroundColor: 'rgba(255, 255, 255, 0.2)' }]}>
                    <Ionicons name="refresh" size={22} color="white" />
                  </View>
                  <Text style={styles.actionButtonText}>Scan Again</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}
          </View>
        </BlurView>
      )}

      {/* Manual Entry Modal */}
      <Modal
        visible={showManualEntry}
        transparent
        animationType="none"
        onRequestClose={closeManualEntry}
      >
        <View style={styles.modalOverlay}>
          <AnimatedView style={[styles.modalContent, manualModalAnimatedStyle]}>
            <LinearGradient
              colors={['#1F2937', '#111827']}
              style={styles.modalGradient}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Add Device Manually</Text>
                <TouchableOpacity onPress={closeManualEntry}>
                  <Ionicons name="close" size={24} color="#9ca3af" />
                </TouchableOpacity>
              </View>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Device ID</Text>
                <TextInput
                  style={[styles.textInput, errors.deviceId && styles.inputError]}
                  value={manualDeviceId}
                  onChangeText={(text) => {
                    setManualDeviceId(text);
                    if (errors.deviceId) {
                      setErrors(prev => ({ ...prev, deviceId: null }));
                    }
                  }}
                  placeholder="Enter device ID"
                  placeholderTextColor="#6B7280"
                  maxLength={50}
                  autoCapitalize="none"
                />
                {errors.deviceId && (
                  <Text style={styles.errorText}>{errors.deviceId}</Text>
                )}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Device Name</Text>
                <TextInput
                  style={[styles.textInput, errors.deviceName && styles.inputError]}
                  value={deviceName}
                  onChangeText={setDeviceName}
                  placeholder="Enter device name"
                  placeholderTextColor="#6B7280"
                  maxLength={50}
                />
                {errors.deviceName && (
                  <Text style={styles.errorText}>{errors.deviceName}</Text>
                )}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Location</Text>
                <TextInput
                  style={[styles.textInput, errors.deviceLocation && styles.inputError]}
                  value={deviceLocation}
                  onChangeText={setDeviceLocation}
                  placeholder="Enter device location"
                  placeholderTextColor="#6B7280"
                  maxLength={100}
                />
                {errors.deviceLocation && (
                  <Text style={styles.errorText}>{errors.deviceLocation}</Text>
                )}
              </View>
              
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={closeManualEntry}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.saveButton]}
                  onPress={handleManualEntry}
                  disabled={isProcessing}
                >
                  <LinearGradient
                    colors={['#06b6d4', '#0891b2']}
                    style={styles.saveButtonGradient}
                  >
                    {isProcessing ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.saveButtonText}>Add Device</Text>
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
  fullScreen: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 15,
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
  },
  headerButtonGradient: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#06b6d440',
    borderRadius: 22,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#1f293780',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#37415140',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  primaryButton: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  buttonGradient: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    alignItems: 'center',
    borderRadius: 16,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
  },
  camera: {
    flex: 1,
  },
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: SAFE_AREA_TOP + 15,
    paddingBottom: 15,
    paddingHorizontal: 20,
    zIndex: 10,
  },
  cameraHeaderButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
  },
  cameraButtonGradient: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#06b6d440',
    borderRadius: 22,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
  },
  scanFrameContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  scanFrame: {
    width: 280,
    height: 280,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 50,
    height: 50,
    borderColor: '#06b6d4',
    borderWidth: 4,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderBottomWidth: 0,
    borderRightWidth: 0,
    borderTopLeftRadius: 12,
  },
  topRight: {
    top: 0,
    right: 0,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderTopRightRadius: 12,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderTopWidth: 0,
    borderRightWidth: 0,
    borderBottomLeftRadius: 12,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderBottomRightRadius: 12,
  },
  processingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  processingContent: {
    alignItems: 'center',
  },
  successBadge: {
    marginBottom: 12,
  },
  processingText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '700',
  },
  instructions: {
    position: 'absolute',
    bottom: 200,
    left: 20,
    right: 20,
    alignItems: 'center',
    zIndex: 1,
  },
  instructionsContent: {
    borderRadius: 12,
    overflow: 'hidden',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  instructionText: {
    fontSize: 14,
    color: '#fff',
    textAlign: 'center',
    fontWeight: '600',
  },
  bottomActionsBlur: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: SAFE_AREA_BOTTOM + 20,
    paddingTop: 20,
    zIndex: 10,
  },
  bottomActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    maxWidth: 180,
  },
  actionButtonContent: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#37415140',
  },
  actionIconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#06b6d420',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  actionButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
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
  inputError: {
    borderColor: '#EF4444',
  },
  errorText: {
    fontSize: 12,
    color: '#EF4444',
    marginTop: 6,
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
});

export default QRScanScreen;