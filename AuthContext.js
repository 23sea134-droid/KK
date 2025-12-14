
// src/context/AuthContext.js
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { authService } from '../services/authService';
import { deviceService } from '../services/deviceService';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AuthContext = createContext({
  user: null,
  loading: true,
  error: null,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
  clearError: () => {},
  login: () => {},
  logout: async () => {},
  clearUserData: () => {},
  updateUserName: async () => {} // Added this
});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isRestoringAuth, setIsRestoringAuth] = useState(true);
  const [initializing, setInitializing] = useState(true);
  const authStateUnsubscribe = useRef(null);
  const isInitialized = useRef(false);

  // Initialize auth service and set up listener
  useEffect(() => {
    let isMounted = true;
    
    const initializeAuth = async () => {
      try {
        console.log('Auth context initializing...');
        
        // Initialize auth service
        await authService.initializeAuth();
        
        if (!isMounted) return;

        // Wait for auth state to be restored from AsyncStorage
        console.log('Waiting for auth state restoration...');
        setIsRestoringAuth(true);
        
        // Give Firebase time to restore the auth state from AsyncStorage
        // This is important for persistence to work properly
        try {
          const authStateResult = await authService.waitForAuthState(5000);
          
          if (!isMounted) return;
          
          console.log('Auth state restoration completed');
        } catch (waitError) {
          console.warn('Auth state wait timeout (this is normal on first launch):', waitError);
        }
        
        setIsRestoringAuth(false);
        
        // Set up auth state listener
        const unsubscribe = authService.onAuthStateChanged((authResult) => {
          if (!isMounted) return;
          
          console.log('Auth state changed:', authResult.success ? 'User signed in' : 'User signed out');
          
          // Handle user state changes with proper cleanup
          if (authResult.success) {
            // User signed in
            const newUser = authResult.user;
            
            // If different user, cleanup previous user's listeners
            if (user && user.uid !== newUser.uid) {
              console.log('Different user detected, cleaning up previous listeners');
              deviceService.cleanupUserListeners(user.uid);
            }
            
            setUser(newUser);
            setError(null);
          } else {
            // User signed out
            if (user) {
              console.log('Cleaning up listeners due to sign out');
              deviceService.cleanupUserListeners(user.uid);
            }
            setUser(null);
          }
          
          // Mark as no longer initializing after first auth state change
          if (initializing) {
            setInitializing(false);
          }
          
          setLoading(false);
        });
        
        authStateUnsubscribe.current = unsubscribe;
        isInitialized.current = true;
        console.log('Auth state listener initialized');
        
      } catch (initError) {
        console.error('Auth initialization error:', initError);
        if (isMounted) {
          setError(initError.message || 'Authentication initialization failed');
          setLoading(false);
          setIsRestoringAuth(false);
          setInitializing(false);
        }
      }
    };

    initializeAuth();

    return () => {
      isMounted = false;
      console.log('Cleaning up auth context');
      if (authStateUnsubscribe.current) {
        authStateUnsubscribe.current();
      }
      // Clean up all device listeners
      deviceService.cleanupAllListeners();
    };
  }, []);

  const signIn = useCallback(async (email, password) => {
    try {
      setLoading(true);
      setError(null);
      
      const result = await authService.signIn(email, password);
      
      if (!result.success) {
        setError(result.error);
        return result;
      }
      
      // User state will be updated by the auth state listener
      return result;
    } catch (error) {
      console.error('Sign in error:', error);
      const errorMessage = error.message || 'Failed to sign in';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  }, []);

  const signUp = useCallback(async (email, password, displayName = '') => {
    try {
      setLoading(true);
      setError(null);
      
      const result = await authService.signUp(email, password, displayName);
      
      if (!result.success) {
        setError(result.error);
        return result;
      }
      
      // User state will be updated by the auth state listener
      return result;
    } catch (error) {
      console.error('Sign up error:', error);
      const errorMessage = error.message || 'Failed to create account';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Clean up listeners before signing out
      if (user) {
        console.log('Cleaning up user listeners before sign out');
        deviceService.cleanupUserListeners(user.uid);
      }
      
      // Clear stored data
      try {
        await AsyncStorage.multiRemove([
          'userToken',
          'userData', 
          'refreshToken',
          'deviceData',
          'userPreferences',
        ]);
        console.log('Cleared stored user data');
      } catch (storageError) {
        console.warn('Error clearing AsyncStorage:', storageError);
      }
      
      const result = await authService.signOut();
      
      if (!result.success) {
        setError(result.error);
        return result;
      }
      
      // User state will be updated by the auth state listener
      console.log('Sign out successful');
      return result;
    } catch (error) {
      console.error('Sign out error:', error);
      const errorMessage = error.message || 'Failed to sign out';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  }, [user]);

  // NEW: Function to update user's display name
  const updateUserName = useCallback(async (name) => {
    try {
      if (!user || !name) {
        return { success: false, error: 'User not authenticated or name is empty' };
      }

      console.log('Updating user name to:', name);
      
      // Update in Firebase Auth and database
      const result = await authService.updateUserProfile({ 
        displayName: name,
        name: name // Also update the name field in database
      });
      
      if (!result.success) {
        return result;
      }
      
      // Update local user state to reflect the change immediately
      setUser(prev => ({
        ...prev,
        displayName: name
      }));
      
      console.log('User name updated successfully in auth context');
      return { success: true };
    } catch (error) {
      console.error('Error updating user name:', error);
      return { success: false, error: error.message || 'Failed to update user name' };
    }
  }, [user]);

  // Legacy login function for backward compatibility
  const login = useCallback((userData) => {
    console.log('Legacy login called - setting user data:', userData?.email);
    setUser(userData);
  }, []);

  // Legacy logout function for backward compatibility
  const logout = useCallback(async () => {
    return await signOut();
  }, [signOut]);

  const clearUserData = useCallback(() => {
    console.log('Clearing user data and listeners');
    if (user) {
      deviceService.cleanupUserListeners(user.uid);
    }
    setUser(null);
  }, [user]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Show loading while restoring auth state from AsyncStorage or initializing
  const shouldShowLoading = loading || isRestoringAuth || initializing;

  const value = React.useMemo(() => ({
    user,
    loading: shouldShowLoading,
    error,
    initializing,
    signIn,
    signUp,
    signOut,
    clearError,
    // Legacy methods for backward compatibility
    login,
    logout,
    clearUserData,
    // New method for updating user name
    updateUserName
  }), [
    user, 
    shouldShowLoading, 
    error, 
    initializing,
    signIn, 
    signUp, 
    signOut, 
    clearError,
    login,
    logout,
    clearUserData,
    updateUserName
  ]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
