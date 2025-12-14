import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { alertService } from '../services/alertService';
import { useFocusEffect } from '@react-navigation/native';

const AlertScreen = ({ navigation }) => {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all', 'unread', 'leak', 'battery'

  useEffect(() => {
    loadAlerts();
  }, [user?.uid]);

  useFocusEffect(
    useCallback(() => {
      loadAlerts();
    }, [user?.uid])
  );

  const loadAlerts = useCallback(async () => {
    if (!user?.uid) return;
    
    try {
      const result = await alertService.getUserAlerts(user.uid);
      if (result.success) {
        setAlerts(result.alerts || []);
      } else {
        Alert.alert('Error', result.error || 'Failed to load alerts');
      }
    } catch (error) {
      console.error('Error loading alerts:', error);
      Alert.alert('Error', 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  const onRefresh = useCallback(async () => {
    if (!user?.uid) return;
    
    setRefreshing(true);
    await loadAlerts();
    setRefreshing(false);
  }, [loadAlerts]);

  const markAsRead = useCallback(async (alertId) => {
    try {
      const result = await alertService.markAlertAsRead(alertId);
      if (result.success) {
        // Update local state
        setAlerts(prev => prev.map(alert => 
          alert.id === alertId ? { ...alert, read: true } : alert
        ));
      }
    } catch (error) {
      console.error('Error marking alert as read:', error);
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    Alert.alert(
      'Mark All as Read',
      'Are you sure you want to mark all alerts as read?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark All',
          onPress: async () => {
            try {
              const unreadAlerts = alerts.filter(alert => !alert.read);
              for (const alert of unreadAlerts) {
                await alertService.markAlertAsRead(alert.id);
              }
              
              // Update local state
              setAlerts(prev => prev.map(alert => ({ ...alert, read: true })));
            } catch (error) {
              console.error('Error marking all as read:', error);
            }
          }
        }
      ]
    );
  }, [alerts]);

  const deleteAlert = useCallback(async (alertId) => {
    Alert.alert(
      'Delete Alert',
      'Are you sure you want to delete this alert?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await alertService.deleteAlert(alertId);
              if (result.success) {
                // Remove from local state
                setAlerts(prev => prev.filter(alert => alert.id !== alertId));
              }
            } catch (error) {
              console.error('Error deleting alert:', error);
            }
          }
        }
      ]
    );
  }, []);

  const clearAllAlerts = useCallback(async () => {
    Alert.alert(
      'Clear All Alerts',
      'Are you sure you want to clear all alerts? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              for (const alert of alerts) {
                await alertService.deleteAlert(alert.id);
              }
              setAlerts([]);
            } catch (error) {
              console.error('Error clearing all alerts:', error);
            }
          }
        }
      ]
    );
  }, [alerts]);

  const getFilteredAlerts = useCallback(() => {
    let filtered = [...alerts].sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    );

    switch (filter) {
      case 'unread':
        return filtered.filter(alert => !alert.read);
      case 'leak':
        return filtered.filter(alert => alert.type === 'leak_detected');
      case 'battery':
        return filtered.filter(alert => alert.type === 'low_battery');
      default:
        return filtered;
    }
  }, [alerts, filter]);

  const getAlertIcon = useCallback((type) => {
    switch (type) {
      case 'leak_detected':
        return { name: 'water', color: '#EF4444' };
      case 'low_battery':
        return { name: 'battery-dead', color: '#F59E0B' };
      case 'valve_closed':
        return { name: 'close-circle', color: '#3B82F6' };
      case 'device_offline':
        return { name: 'wifi-off', color: '#6B7280' };
      default:
        return { name: 'warning', color: '#8B5CF6' };
    }
  }, []);

  const getAlertTitle = useCallback((type) => {
    switch (type) {
      case 'leak_detected':
        return 'Leak Detected';
      case 'low_battery':
        return 'Low Battery Alert';
      case 'valve_closed':
        return 'Valve Closed';
      case 'device_offline':
        return 'Device Offline';
      default:
        return 'System Alert';
    }
  }, []);

  const formatTime = useCallback((timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) {
      return `${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
    } else {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  }, []);

  const renderAlertItem = useCallback(({ item }) => {
    const icon = getAlertIcon(item.type);
    
    return (
      <TouchableOpacity 
        style={[styles.alertCard, !item.read && styles.unreadAlert]}
        onPress={() => markAsRead(item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.alertHeader}>
          <View style={[styles.iconContainer, { backgroundColor: `${icon.color}20` }]}>
            <Ionicons name={icon.name} size={24} color={icon.color} />
          </View>
          <View style={styles.alertInfo}>
            <Text style={styles.alertTitle}>{item.title || getAlertTitle(item.type)}</Text>
            <Text style={styles.alertTime}>{formatTime(item.createdAt)}</Text>
          </View>
          {!item.read && (
            <View style={styles.unreadDot} />
          )}
        </View>
        
        <Text style={styles.alertMessage}>{item.message}</Text>
        
        {item.deviceName && (
          <View style={styles.deviceInfo}>
            <Ionicons name="hardware-chip" size={16} color="#9ca3af" />
            <Text style={styles.deviceName}>{item.deviceName}</Text>
          </View>
        )}
        
        <View style={styles.alertActions}>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => markAsRead(item.id)}
          >
            <Ionicons 
              name={item.read ? 'checkmark-circle' : 'checkmark-circle-outline'} 
              size={20} 
              color={item.read ? '#10B981' : '#9ca3af'} 
            />
            <Text style={[styles.actionText, item.read && styles.actionTextRead]}>
              {item.read ? 'Read' : 'Mark Read'}
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => deleteAlert(item.id)}
          >
            <Ionicons name="trash-outline" size={20} color="#EF4444" />
            <Text style={[styles.actionText, styles.deleteText]}>Delete</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  }, [getAlertIcon, getAlertTitle, formatTime, markAsRead, deleteAlert]);

  const renderEmptyState = useCallback(() => (
    <View style={styles.emptyState}>
      <Ionicons name="notifications-off" size={80} color="#37415180" />
      <Text style={styles.emptyStateTitle}>No Alerts</Text>
      <Text style={styles.emptyStateSubtitle}>
        You're all caught up! No alerts to display.
      </Text>
    </View>
  ), []);

  if (loading) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={['#030712', '#111827', '#000000']}
          style={[styles.gradient, { justifyContent: 'center', alignItems: 'center' }]}
        >
          <ActivityIndicator size="large" color="#06b6d4" />
          <Text style={styles.loadingText}>Loading alerts...</Text>
        </LinearGradient>
      </View>
    );
  }

  const filteredAlerts = getFilteredAlerts();
  const unreadCount = alerts.filter(alert => !alert.read).length;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      <LinearGradient
        colors={['#030712', '#111827', '#000000']}
        style={styles.gradient}
      >
        {/* Header */}
        <LinearGradient
          colors={['#030712', '#111827']}
          style={styles.header}
        >
          <View style={styles.headerContent}>
            <TouchableOpacity 
              style={styles.backButton}
              onPress={() => navigation.goBack()}
            >
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            
            <Text style={styles.headerTitle}>Alerts</Text>
            
            <View style={styles.headerActions}>
              {unreadCount > 0 && (
                <TouchableOpacity 
                  style={styles.markAllButton}
                  onPress={markAllAsRead}
                >
                  <Ionicons name="checkmark-done" size={20} color="#10B981" />
                </TouchableOpacity>
              )}
              
              {alerts.length > 0 && (
                <TouchableOpacity 
                  style={styles.clearAllButton}
                  onPress={clearAllAlerts}
                >
                  <Ionicons name="trash" size={20} color="#EF4444" />
                </TouchableOpacity>
              )}
            </View>
          </View>
          
          {/* Filter Tabs */}
          <View style={styles.filterContainer}>
            {['all', 'unread', 'leak', 'battery'].map((filterType) => (
              <TouchableOpacity
                key={filterType}
                style={[
                  styles.filterButton,
                  filter === filterType && styles.filterButtonActive
                ]}
                onPress={() => setFilter(filterType)}
              >
                <Text style={[
                  styles.filterText,
                  filter === filterType && styles.filterTextActive
                ]}>
                  {filterType === 'all' && 'All'}
                  {filterType === 'unread' && `Unread ${unreadCount > 0 ? `(${unreadCount})` : ''}`}
                  {filterType === 'leak' && 'Leaks'}
                  {filterType === 'battery' && 'Battery'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </LinearGradient>

        <FlatList
          data={filteredAlerts}
          renderItem={renderAlertItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={renderEmptyState}
          refreshControl={
            <RefreshControl 
              refreshing={refreshing} 
              onRefresh={onRefresh} 
              tintColor="#06b6d4"
              colors={['#06b6d4']}
            />
          }
        />
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
  header: {
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 12,
  },
  markAllButton: {
    padding: 8,
  },
  clearAllButton: {
    padding: 8,
  },
  filterContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1f2937',
  },
  filterButtonActive: {
    backgroundColor: '#06b6d4',
  },
  filterText: {
    fontSize: 14,
    color: '#9ca3af',
    fontWeight: '600',
  },
  filterTextActive: {
    color: '#fff',
  },
  listContent: {
    padding: 20,
    paddingBottom: 40,
  },
  alertCard: {
    backgroundColor: '#1f293780',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#37415140',
  },
  unreadAlert: {
    backgroundColor: '#1e40af20',
    borderColor: '#3B82F640',
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  alertInfo: {
    flex: 1,
  },
  alertTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  alertTime: {
    fontSize: 12,
    color: '#9ca3af',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3B82F6',
  },
  alertMessage: {
    fontSize: 14,
    color: '#d1d5db',
    marginBottom: 12,
    lineHeight: 20,
  },
  deviceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111827',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  deviceName: {
    fontSize: 12,
    color: '#9ca3af',
    marginLeft: 6,
  },
  alertActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#37415140',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionText: {
    fontSize: 12,
    color: '#9ca3af',
  },
  actionTextRead: {
    color: '#10B981',
  },
  deleteText: {
    color: '#EF4444',
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
    marginTop: 40,
  },
  emptyStateTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 16,
  },
  emptyStateSubtitle: {
    fontSize: 16,
    color: '#9ca3af',
    marginTop: 8,
    textAlign: 'center',
  },
  loadingText: {
    color: '#9ca3af',
    fontSize: 16,
    marginTop: 16,
  },
});

export default AlertScreen;