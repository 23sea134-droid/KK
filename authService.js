import { 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  deleteUser
} from 'firebase/auth';
import { ref, set, get, update } from 'firebase/database';
import { getFirebaseAuth, getFirebaseDatabase, ensureFirebaseInitialized } from './firebaseConfig';

// Authentication service
export const authService = {
  // Initialize Firebase before any auth operations
  initializeAuth: async () => {
    try {
      await ensureFirebaseInitialized();
      console.log('Auth service initialized successfully');
      return true;
    } catch (error) {
      console.error('Auth service initialization failed:', error);
      throw error;
    }
  },

  // Sign in with email and password
  signIn: async (email, password) => {
    try {
      // Ensure Firebase is initialized
      await ensureFirebaseInitialized();
      
      if (!email || !password) {
        throw new Error('Email and password are required');
      }

      const auth = getFirebaseAuth();
      console.log('Attempting to sign in user:', email);
      
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      console.log('User signed in successfully:', user.uid);
      
      // Update last login time in database
      try {
        const database = getFirebaseDatabase();
        const userRef = ref(database, `users/${user.uid}/profile`);
        await update(userRef, {
          lastLoginTime: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        console.log('Updated user last login time');
      } catch (updateError) {
        console.warn('Failed to update last login time:', updateError);
        // Don't throw error for non-critical operation
      }
      
      return {
        success: true,
        user: {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          emailVerified: user.emailVerified
        }
      };
    } catch (error) {
      console.error('Sign in error:', error);
      
      let errorMessage = 'Failed to sign in';
      
      switch (error.code) {
        case 'auth/user-not-found':
          errorMessage = 'No account found with this email address';
          break;
        case 'auth/wrong-password':
          errorMessage = 'Incorrect password';
          break;
        case 'auth/invalid-email':
          errorMessage = 'Invalid email address';
          break;
        case 'auth/user-disabled':
          errorMessage = 'This account has been disabled';
          break;
        case 'auth/too-many-requests':
          errorMessage = 'Too many failed attempts. Please try again later';
          break;
        case 'auth/network-request-failed':
          errorMessage = 'Network error. Please check your connection';
          break;
        case 'auth/invalid-credential':
          errorMessage = 'Invalid email or password';
          break;
        default:
          errorMessage = error.message || 'Failed to sign in';
      }
      
      return {
        success: false,
        error: errorMessage,
        code: error.code
      };
    }
  },

  // Sign up with email and password
  signUp: async (email, password, displayName = '') => {
    try {
      // Ensure Firebase is initialized
      await ensureFirebaseInitialized();
      
      if (!email || !password) {
        throw new Error('Email and password are required');
      }

      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters long');
      }

      const auth = getFirebaseAuth();
      const database = getFirebaseDatabase();
      
      console.log('Attempting to create user account:', email);
      
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      console.log('User account created successfully:', user.uid);
      
      // Update display name if provided
      if (displayName) {
        try {
          await updateProfile(user, { displayName });
          console.log('Display name updated successfully');
        } catch (updateError) {
          console.warn('Failed to update display name:', updateError);
        }
      }
      
      // Create user profile in database
      try {
        const userProfile = {
          userId: user.uid,
          email: user.email,
          displayName: displayName || '',
          name: displayName || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastLoginTime: new Date().toISOString()
        };
        
        const userRef = ref(database, `users/${user.uid}/profile`);
        await set(userRef, userProfile);
        
        // Initialize default settings
        const settingsRef = ref(database, `users/${user.uid}/settings`);
        await set(settingsRef, {
          notifications: {
            leakAlerts: true,
            usageReports: true,
            systemUpdates: true,
            updatedAt: new Date().toISOString()
          },
          thresholds: {
            leakThreshold: 50,
            maxFlowThreshold: 1000,
            lowBatteryThreshold: 20
          },
          updatedAt: new Date().toISOString()
        });
        
        console.log('User profile and settings created in database');
      } catch (dbError) {
        console.warn('Failed to create user profile in database:', dbError);
        // Don't throw error, user account was created successfully
      }
      
      return {
        success: true,
        user: {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || displayName,
          emailVerified: user.emailVerified
        }
      };
    } catch (error) {
      console.error('Sign up error:', error);
      
      let errorMessage = 'Failed to create account';
      
      switch (error.code) {
        case 'auth/email-already-in-use':
          errorMessage = 'An account with this email already exists';
          break;
        case 'auth/invalid-email':
          errorMessage = 'Invalid email address';
          break;
        case 'auth/weak-password':
          errorMessage = 'Password is too weak. Please choose a stronger password';
          break;
        case 'auth/operation-not-allowed':
          errorMessage = 'Email/password accounts are not enabled';
          break;
        case 'auth/network-request-failed':
          errorMessage = 'Network error. Please check your connection';
          break;
        default:
          errorMessage = error.message || 'Failed to create account';
      }
      
      return {
        success: false,
        error: errorMessage,
        code: error.code
      };
    }
  },

  // Sign out
  signOut: async () => {
    try {
      const auth = getFirebaseAuth();
      await signOut(auth);
      console.log('User signed out successfully');
      
      return {
        success: true
      };
    } catch (error) {
      console.error('Sign out error:', error);
      
      return {
        success: false,
        error: error.message || 'Failed to sign out'
      };
    }
  },

  // Get current user
  getCurrentUser: () => {
    try {
      const auth = getFirebaseAuth();
      const user = auth.currentUser;
      
      if (user) {
        return {
          success: true,
          user: {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            emailVerified: user.emailVerified
          }
        };
      } else {
        return {
          success: false,
          error: 'No user is currently signed in'
        };
      }
    } catch (error) {
      console.error('Get current user error:', error);
      return {
        success: false,
        error: error.message || 'Failed to get current user'
      };
    }
  },

  // Listen to auth state changes
  onAuthStateChanged: (callback) => {
    try {
      const auth = getFirebaseAuth();
      
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        if (user) {
          console.log('Auth state changed: User signed in:', user.uid);
          callback({
            success: true,
            user: {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
              emailVerified: user.emailVerified
            }
          });
        } else {
          console.log('Auth state changed: User signed out');
          callback({
            success: false,
            user: null
          });
        }
      });
      
      return unsubscribe;
    } catch (error) {
      console.error('Auth state listener error:', error);
      callback({
        success: false,
        error: error.message || 'Failed to set up auth state listener'
      });
      return () => {}; // Return empty function for cleanup
    }
  },

  // Update user profile
  updateUserProfile: async (updates) => {
    try {
      const auth = getFirebaseAuth();
      const user = auth.currentUser;
      
      if (!user) {
        throw new Error('No user is currently signed in');
      }
      
      // Update Firebase Auth profile
      const authUpdates = {};
      if (updates.displayName !== undefined) {
        authUpdates.displayName = updates.displayName;
      }
      
      if (Object.keys(authUpdates).length > 0) {
        await updateProfile(user, authUpdates);
        console.log('Firebase Auth profile updated successfully');
      }
      
      // Update database profile
      const database = getFirebaseDatabase();
      const userRef = ref(database, `users/${user.uid}/profile`);
      
      const dbUpdates = {
        ...updates,
        updatedAt: new Date().toISOString()
      };
      
      await update(userRef, dbUpdates);
      console.log('Database profile updated successfully');
      
      return {
        success: true
      };
    } catch (error) {
      console.error('Update profile error:', error);
      
      return {
        success: false,
        error: error.message || 'Failed to update profile'
      };
    }
  },

  // Send password reset email
  resetPassword: async (email) => {
    try {
      if (!email) {
        throw new Error('Email address is required');
      }
      
      const auth = getFirebaseAuth();
      await sendPasswordResetEmail(auth, email);
      console.log('Password reset email sent to:', email);
      
      return {
        success: true,
        message: 'Password reset email sent successfully'
      };
    } catch (error) {
      console.error('Password reset error:', error);
      
      let errorMessage = 'Failed to send password reset email';
      
      switch (error.code) {
        case 'auth/user-not-found':
          errorMessage = 'No account found with this email address';
          break;
        case 'auth/invalid-email':
          errorMessage = 'Invalid email address';
          break;
        case 'auth/network-request-failed':
          errorMessage = 'Network error. Please check your connection';
          break;
        default:
          errorMessage = error.message || 'Failed to send password reset email';
      }
      
      return {
        success: false,
        error: errorMessage,
        code: error.code
      };
    }
  },

  // Change password
  changePassword: async (currentPassword, newPassword) => {
    try {
      if (!currentPassword || !newPassword) {
        throw new Error('Current password and new password are required');
      }
      
      if (newPassword.length < 6) {
        throw new Error('New password must be at least 6 characters long');
      }
      
      const auth = getFirebaseAuth();
      const user = auth.currentUser;
      
      if (!user) {
        throw new Error('No user is currently signed in');
      }
      
      // Reauthenticate user
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      console.log('User reauthenticated successfully');
      
      // Update password
      await updatePassword(user, newPassword);
      console.log('Password updated successfully');
      
      return {
        success: true,
        message: 'Password updated successfully'
      };
    } catch (error) {
      console.error('Change password error:', error);
      
      let errorMessage = 'Failed to change password';
      
      switch (error.code) {
        case 'auth/wrong-password':
          errorMessage = 'Current password is incorrect';
          break;
        case 'auth/weak-password':
          errorMessage = 'New password is too weak';
          break;
        case 'auth/requires-recent-login':
          errorMessage = 'Please sign out and sign in again before changing password';
          break;
        default:
          errorMessage = error.message || 'Failed to change password';
      }
      
      return {
        success: false,
        error: errorMessage,
        code: error.code
      };
    }
  },

  // Delete user account
  deleteAccount: async (password) => {
    try {
      if (!password) {
        throw new Error('Password is required to delete account');
      }
      
      const auth = getFirebaseAuth();
      const database = getFirebaseDatabase();
      const user = auth.currentUser;
      
      if (!user) {
        throw new Error('No user is currently signed in');
      }
      
      const userId = user.uid;
      
      // Reauthenticate user
      const credential = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, credential);
      console.log('User reauthenticated for account deletion');
      
      // Delete user data from database
      try {
        const userRef = ref(database, `users/${userId}`);
        await set(userRef, null);
        console.log('User data deleted from database');
      } catch (dbError) {
        console.warn('Failed to delete user data from database:', dbError);
        // Continue with account deletion even if database cleanup fails
      }
      
      // Delete user account
      await deleteUser(user);
      console.log('User account deleted successfully');
      
      return {
        success: true,
        message: 'Account deleted successfully'
      };
    } catch (error) {
      console.error('Delete account error:', error);
      
      let errorMessage = 'Failed to delete account';
      
      switch (error.code) {
        case 'auth/wrong-password':
          errorMessage = 'Incorrect password';
          break;
        case 'auth/requires-recent-login':
          errorMessage = 'Please sign out and sign in again before deleting account';
          break;
        default:
          errorMessage = error.message || 'Failed to delete account';
      }
      
      return {
        success: false,
        error: errorMessage,
        code: error.code
      };
    }
  },

  // Get user profile from database
  getUserProfile: async (userId) => {
    try {
      if (!userId) {
        const auth = getFirebaseAuth();
        const user = auth.currentUser;
        if (!user) {
          throw new Error('No user is currently signed in');
        }
        userId = user.uid;
      }
      
      const database = getFirebaseDatabase();
      const userRef = ref(database, `users/${userId}/profile`);
      const snapshot = await get(userRef);
      
      if (snapshot.exists()) {
        const profile = snapshot.val();
        console.log('User profile retrieved successfully');
        
        return {
          success: true,
          profile
        };
      } else {
        return {
          success: false,
          error: 'User profile not found'
        };
      }
    } catch (error) {
      console.error('Get user profile error:', error);
      
      return {
        success: false,
        error: error.message || 'Failed to get user profile'
      };
    }
  },

  // Check if user is authenticated
  isAuthenticated: () => {
    try {
      const auth = getFirebaseAuth();
      return auth.currentUser !== null;
    } catch (error) {
      console.error('Authentication check error:', error);
      return false;
    }
  },

  // Wait for authentication state to be resolved
  waitForAuthState: async (timeout = 10000) => {
    try {
      const auth = getFirebaseAuth();
      
      return new Promise((resolve, reject) => {
        // If user is already available, resolve immediately
        if (auth.currentUser) {
          resolve({
            success: true,
            user: {
              uid: auth.currentUser.uid,
              email: auth.currentUser.email,
              displayName: auth.currentUser.displayName,
              emailVerified: auth.currentUser.emailVerified
            }
          });
          return;
        }
        
        let timeoutId;
        
        const unsubscribe = onAuthStateChanged(auth, (user) => {
          if (timeoutId) clearTimeout(timeoutId);
          unsubscribe();
          
          if (user) {
            resolve({
              success: true,
              user: {
                uid: user.uid,
                email: user.email,
                displayName: user.displayName,
                emailVerified: user.emailVerified
              }
            });
          } else {
            resolve({
              success: false,
              user: null
            });
          }
        });
        
        // Set timeout
        timeoutId = setTimeout(() => {
          unsubscribe();
          reject(new Error('Authentication state timeout'));
        }, timeout);
      });
    } catch (error) {
      console.error('Wait for auth state error:', error);
      return {
        success: false,
        error: error.message || 'Failed to wait for authentication state'
      };
    }
  }
};