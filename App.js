import React, { useEffect, useState, useCallback, useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, ActivityIndicator, TouchableOpacity, Platform, Animated, Dimensions, StyleSheet, Text, Alert, StatusBar } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Screens
import LoginScreen from './src/screens/LoginScreen';
import SignupScreen from './src/screens/SignupScreen';
import HomeScreen from './src/screens/HomeScreen';
import StatusScreen from './src/screens/StatusScreen';
import AnalyticsScreen from './src/screens/AnalyticsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import QRScanScreen from './src/screens/QRScanScreen';
import AboutScreen from './src/screens/AboutScreen';
import AlertScreen from './src/screens/AlertScreen';

// Services
import { initializeFirebase } from './src/services/firebaseConfig';
import { deviceService } from './src/services/deviceService';
import { alertService } from './src/services/alertService';
import { batteryMonitorService } from './src/services/batteryMonitorService';

// Import the improved auth context
import { AuthProvider, useAuth } from './src/context/AuthContext';

// Import the separated TabBar context
import { TabBarProvider, useTabBar } from './src/context/TabBarContext';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();
const { width, height } = Dimensions.get('window');

// ====================
// Custom Tab Bar Component (Apple Watch Style with Smooth Animation)
// ====================
const CustomTabBar = ({ state, descriptors, navigation }) => {
  const { tabBarAnimatedValue, isTabBarVisible } = useTabBar();
  const [activeTab, setActiveTab] = useState(state.index);
  
  // Animated value for the active pill position
  const pillAnimation = useRef(new Animated.Value(state.index)).current;
  
  // Animated values for scale effect on each tab
  const scaleAnimations = useRef(
    state.routes.map(() => new Animated.Value(1))
  ).current;

  // Colors based on the design - Updated for better contrast
  const COLORS = {
    darkBackground: '#000000',
    tabBarBackground: 'rgba(30, 30, 30, 0.7)',
    defaultIcon: 'rgba(255, 255, 255, 0.5)',
    defaultText: 'rgba(255, 255, 255, 0.6)',
    activeIcon: '#FF9F0A',
    activeText: '#FF9F0A',
    activePill: 'rgba(80, 80, 80, 0.8)',
  };

  useEffect(() => {
    // Animate pill position
    Animated.spring(pillAnimation, {
      toValue: state.index,
      useNativeDriver: true,
      damping: 20,
      stiffness: 150,
      mass: 1,
    }).start();

    // Animate scale for all tabs
    scaleAnimations.forEach((anim, index) => {
      Animated.spring(anim, {
        toValue: state.index === index ? 1 : 1,
        useNativeDriver: true,
        damping: 15,
        stiffness: 150,
      }).start();
    });

    setActiveTab(state.index);
  }, [state.index]);

  const handleTabPress = (route, index) => {
    const event = navigation.emit({
      type: "tabPress",
      target: route.key,
      canPreventDefault: true,
    });
    if (!event.defaultPrevented) {
      navigation.navigate(route.name);
    }
  };

  const getIconName = (routeName) => {
    switch (routeName) {
      case "Home":
        return "home";
      case "Status":
        return "update";
      case "Analytics":
        return "analytics";
      case "Profile":
        return "person";
      case "QRScan":
        return "qr-code-scanner";
      default:
        return "home";
    }
  };

  const getTabLabel = (routeName) => {
    if (routeName === "QRScan") return "Scan";
    return routeName;
  };

  // Apply smooth hide/show animation
  const animatedStyle = {
    transform: [
      {
        translateY: tabBarAnimatedValue.interpolate({
          inputRange: [0, 1],
          outputRange: [120, 0],
        }),
      },
      {
        scale: tabBarAnimatedValue.interpolate({
          inputRange: [0, 1],
          outputRange: [0.9, 1],
        }),
      },
    ],
    opacity: tabBarAnimatedValue,
  };

  // Calculate pill position based on number of tabs
  const tabWidth = (width - 40) / state.routes.length;
  
  const pillStyle = {
    position: 'absolute',
    left: 0,
    top: 3,
    bottom: 3,
    width: tabWidth - 8,
    borderRadius: 25,
    backgroundColor: COLORS.activePill,
    marginHorizontal: 4,
    transform: [
      {
        translateX: pillAnimation.interpolate({
          inputRange: state.routes.map((_, i) => i),
          outputRange: state.routes.map((_, i) => i * tabWidth),
        }),
      },
    ],
  };

  // Helper component for a single tab button
  const TabButton = ({ route, index }) => {
    const isActive = activeTab === index;
    const iconName = getIconName(route.name);
    const label = getTabLabel(route.name);

    const color = isActive ? COLORS.activeIcon : COLORS.defaultIcon;
    const textStyle = { 
      color: isActive ? COLORS.activeText : COLORS.defaultText,
      fontSize: 12,
      marginTop: 4,
      fontWeight: isActive ? '700' : '600',
    };
    const iconSize = 24;

    return (
      <TouchableOpacity
        style={styles.tabContainer}
        onPress={() => handleTabPress(route, index)}
        activeOpacity={0.7}
      >
        <Animated.View
          style={{
            alignItems: 'center',
            transform: [{ scale: scaleAnimations[index] }],
          }}
        >
          <Icon name={iconName} size={iconSize} color={color} />
          <Text style={textStyle}>{label}</Text>
        </Animated.View>
      </TouchableOpacity>
    );
  };

  return (
    <Animated.View 
      style={[styles.customTabBarContainer, animatedStyle]} 
      pointerEvents={isTabBarVisible ? 'auto' : 'none'}
    >
      <View style={styles.mainTabBarPill}>
        <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
        
        {/* Animated active pill background */}
        <Animated.View style={pillStyle} />
        
        <View style={styles.tabBarContent}>
          {state.routes.map((route, index) => (
            <TabButton
              key={route.key}
              route={route}
              index={index}
            />
          ))}
        </View>
      </View>
    </Animated.View>
  );
};

// ====================
// Tab Navigator with Battery Monitoring
// ====================
const TabNavigator = () => {
  const { user } = useAuth();
  const { showTabBar } = useTabBar();
  
  useEffect(() => {
    if (user) {
      console.log('Tab Navigator mounted for user:', user.uid);
      showTabBar();
      
      // Start battery monitoring for all user devices
      console.log('🔋 Starting battery monitoring for user devices...');
      batteryMonitorService.monitorAllDevices(user.uid)
        .then(result => {
          if (result.success) {
            console.log(`✅ Battery monitoring started for ${result.monitored} devices`);
          } else {
            console.error('❌ Failed to start battery monitoring:', result.error);
          }
        })
        .catch(error => {
          console.error('❌ Error starting battery monitoring:', error);
        });
    }
    
    return () => {
      if (user) {
        console.log('Tab Navigator unmounting, cleaning up listeners for user:', user.uid);
        deviceService.cleanupUserListeners(user.uid);
        batteryMonitorService.stopAllMonitoring();
      }
    };
  }, [user, showTabBar]);

  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator
        tabBar={(props) => <CustomTabBar {...props} />}
        screenOptions={{ 
          headerShown: false, 
          tabBarStyle: { display: 'none' },
          tabBarHideOnKeyboard: true
        }}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="Status" component={StatusScreen} />
        <Tab.Screen name="QRScan" component={QRScanScreen} />
        <Tab.Screen name="Analytics" component={AnalyticsScreen} />
        <Tab.Screen name="Profile" component={ProfileScreen} />
      </Tab.Navigator>
    </View>
  );
};

// ====================
// Error Boundary Component
// ====================
class AuthErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Auth Error Boundary caught error:', error, errorInfo);
    
    try {
      deviceService.cleanupAllListeners();
      batteryMonitorService.stopAllMonitoring();
    } catch (cleanupError) {
      console.error('Error during cleanup:', cleanupError);
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <LinearGradient colors={['#030712', '#111827', '#000000']} style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <View style={{ 
            backgroundColor: '#1f293780', 
            borderRadius: 24, 
            padding: 40, 
            alignItems: 'center', 
            maxWidth: 320,
            borderWidth: 1,
            borderColor: '#37415140'
          }}>
            <Ionicons name="alert-circle" size={60} color="#EF4444" style={{ marginBottom: 20 }} />
            <Text style={{ fontSize: 18, fontWeight: '600', color: '#FFFFFF', textAlign: 'center', marginBottom: 10 }}>
              Authentication Error
            </Text>
            <Text style={{ fontSize: 14, color: '#9ca3af', textAlign: 'center', marginBottom: 30 }}>
              There was a problem with authentication. Please try again.
            </Text>
            <TouchableOpacity
              style={{
                backgroundColor: '#06b6d420',
                paddingHorizontal: 30,
                paddingVertical: 12,
                borderRadius: 25,
                borderWidth: 1,
                borderColor: '#06b6d440'
              }}
              onPress={this.handleRetry}
            >
              <Text style={{ color: '#06b6d4', fontSize: 16, fontWeight: '600' }}>Retry</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      );
    }

    return this.props.children;
  }
}

// ====================
// Enhanced Loading Screen
// ====================
const LoadingScreen = ({ message = "Loading..." }) => {
  const [pulseAnim] = useState(new Animated.Value(1));
  const [rotateAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.2,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 2000,
        useNativeDriver: true,
      })
    ).start();
  }, []);

  const rotate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <LinearGradient colors={['#030712', '#111827', '#000000']} style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <StatusBar barStyle="light-content" />
      <View style={{
        backgroundColor: '#1f293780',
        borderRadius: 30,
        padding: 50,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#37415140',
        minWidth: 280,
      }}>
        <Animated.View style={{
          transform: [{ scale: pulseAnim }],
          marginBottom: 25,
        }}>
          <View style={{
            width: 90,
            height: 90,
            borderRadius: 45,
            backgroundColor: '#06b6d420',
            justifyContent: 'center',
            alignItems: 'center',
            borderWidth: 2,
            borderColor: '#06b6d440',
          }}>
            <Ionicons name="water" size={45} color="#06b6d4" />
          </View>
        </Animated.View>

        <Animated.View style={{
          transform: [{ rotate }],
          marginBottom: 20,
        }}>
          <View style={{
            width: 40,
            height: 40,
            borderWidth: 3,
            borderColor: '#37415140',
            borderTopColor: '#06b6d4',
            borderRadius: 20,
          }} />
        </Animated.View>

        <Text style={{
          color: '#FFFFFF',
          fontSize: 18,
          fontWeight: '600',
          textAlign: 'center',
          marginBottom: 8,
        }}>
          {message}
        </Text>
        
        <Text style={{
          color: '#9ca3af',
          fontSize: 14,
          textAlign: 'center',
        }}>
          Please wait a moment
        </Text>
      </View>
    </LinearGradient>
  );
};

// ====================
// App Navigator
// ====================
function AppNavigator() {
  const { user, loading, error } = useAuth();
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    if (error) {
      console.error('Auth context error:', error);
      setAuthError(error);
      
      Alert.alert(
        'Authentication Error',
        'There was a problem with your authentication. Please try logging in again.',
        [{ text: 'OK', onPress: () => setAuthError(null) }]
      );
    }
  }, [error]);

  useEffect(() => {
    return () => {
      console.log('AppNavigator unmounting, cleaning up all listeners');
      deviceService.cleanupAllListeners();
      batteryMonitorService.stopAllMonitoring();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      console.log('User logged out, cleaning up all listeners');
      deviceService.cleanupAllListeners();
      batteryMonitorService.stopAllMonitoring();
    }
  }, [user]);

  if (loading) {
    return <LoadingScreen message="Restoring session..." />;
  }

  if (authError) {
    return (
      <LinearGradient colors={['#030712', '#111827', '#000000']} style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <StatusBar barStyle="light-content" />
        <View style={{ 
          backgroundColor: '#1f293780', 
          borderRadius: 24, 
          padding: 40, 
          alignItems: 'center', 
          maxWidth: 320,
          borderWidth: 1,
          borderColor: '#37415140'
        }}>
          <Ionicons name="warning" size={60} color="#F59E0B" style={{ marginBottom: 20 }} />
          <Text style={{ fontSize: 18, fontWeight: '600', color: '#FFFFFF', textAlign: 'center', marginBottom: 10 }}>
            Connection Issue
          </Text>
          <Text style={{ fontSize: 14, color: '#9ca3af', textAlign: 'center', marginBottom: 30 }}>
            Please check your internet connection and try again.
          </Text>
          <TouchableOpacity
            style={{
              backgroundColor: '#06b6d420',
              paddingHorizontal: 30,
              paddingVertical: 12,
              borderRadius: 25,
              borderWidth: 1,
              borderColor: '#06b6d440'
            }}
            onPress={() => setAuthError(null)}
          >
            <Text style={{ color: '#06b6d4', fontSize: 16, fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    );
  }

  return user ? (
    <TabBarProvider>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="MainTabs" component={TabNavigator} />
        <Stack.Screen 
          name="Alerts" 
          component={AlertScreen}
          options={{
            presentation: 'card',
            gestureEnabled: true,
          }}
        />
        <Stack.Screen 
          name="About" 
          component={AboutScreen}
          options={{
            presentation: 'modal',
            gestureEnabled: true,
          }}
        />
      </Stack.Navigator>
    </TabBarProvider>
  ) : (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Signup" component={SignupScreen} />
    </Stack.Navigator>
  );
}

// ====================
// Main App
// ====================
export default function App() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState(null);

  const initializeApp = useCallback(async () => {
    try {
      console.log('Initializing Firebase...');
      await initializeFirebase();
      console.log('✅ Firebase initialized successfully');
      setIsInitialized(true);
    } catch (error) {
      console.error('❌ Firebase initialization error:', error);
      setInitError(error);
      setIsInitialized(true);
    }
  }, []);

  useEffect(() => {
    initializeApp();
    
    return () => {
      console.log('App unmounting, cleaning up all listeners');
      try {
        deviceService.cleanupAllListeners();
        batteryMonitorService.stopAllMonitoring();
      } catch (error) {
        console.error('Error during app cleanup:', error);
      }
    };
  }, [initializeApp]);

  if (!isInitialized) {
    return <LoadingScreen message="Initializing app..." />;
  }

  if (initError) {
    return (
      <LinearGradient colors={['#030712', '#111827', '#000000']} style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <StatusBar barStyle="light-content" />
        <View style={{ 
          backgroundColor: '#1f293780', 
          borderRadius: 24, 
          padding: 40, 
          alignItems: 'center', 
          maxWidth: 320,
          borderWidth: 1,
          borderColor: '#37415140'
        }}>
          <Ionicons name="cloud-offline" size={60} color="#EF4444" style={{ marginBottom: 20 }} />
          <Text style={{ fontSize: 18, fontWeight: '600', color: '#FFFFFF', textAlign: 'center', marginBottom: 10 }}>
            Initialization Failed
          </Text>
          <Text style={{ fontSize: 14, color: '#9ca3af', textAlign: 'center', marginBottom: 30 }}>
            Unable to connect to services. Please check your internet connection.
          </Text>
          <TouchableOpacity
            style={{
              backgroundColor: '#06b6d420',
              paddingHorizontal: 30,
              paddingVertical: 12,
              borderRadius: 25,
              borderWidth: 1,
              borderColor: '#06b6d440'
            }}
            onPress={() => {
              setInitError(null);
              setIsInitialized(false);
              initializeApp();
            }}
          >
            <Text style={{ color: '#06b6d4', fontSize: 16, fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthErrorBoundary>
        <AuthProvider>
          <LinearGradient colors={['#030712', '#111827', '#000000']} style={{ flex: 1 }}>
            <StatusBar barStyle="light-content" />
            <NavigationContainer>
              <AppNavigator />
            </NavigationContainer>
          </LinearGradient>
        </AuthProvider>
      </AuthErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  customTabBarContainer: {
    position: "absolute",
    bottom: 30,
    left: 20,
    right: 20,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },

  mainTabBarPill: {
    borderRadius: 30,
    overflow: 'hidden',
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    shadowColor: "#ffffff1c",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },

  tabBarContent: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 1,
  },

  tabContainer: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 5,
    borderRadius: 25,
    marginHorizontal: 4,
  },
});