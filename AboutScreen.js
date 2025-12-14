import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Image,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

const AboutScreen = ({ navigation }) => {
  const teamMembers = [
    {
      name: 'Kanagaratnam Kirushan',
      role: 'CEO & Founder',
      icon: 'person',
      iconColor: '#06b6d4',
      iconBg: '#06b6d420',
    },
    {
      name: 'Mariya Justin',
      role: 'Hardware Engineer',
      icon: 'hardware-chip',
      iconColor: '#8B5CF6',
      iconBg: '#8B5CF620',
    },
  ];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={['#030712', '#111827', '#000000']}
        style={styles.gradient}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>About Us</Text>
          <View style={styles.placeholder} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Logo Section - Circular Format without background */}
          <View style={styles.logoSection}>
            <View style={styles.logoContainer}>
              <Image
                source={require('../../assets/AquaTrackX_Logo.png')}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.companyName}>AquaTrackX</Text>
            <Text style={styles.tagline}>Smart Water Management Solution</Text>
          </View>

          {/* Mission Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="water" size={24} color="#06b6d4" />
              <Text style={styles.sectionTitle}>Our Mission</Text>
            </View>
            <View style={styles.missionCard}>
              <LinearGradient
                colors={['#1f293780', '#11182780']}
                style={styles.missionGradient}
              >
                <Text style={styles.missionText}>
                  Making water conservation accessible and actionable for
                  households across Sri Lanka. We help people understand their
                  water usage patterns, reduce wastage, and make informed
                  decisions that support sustainable water management for the
                  nation's future.
                </Text>
              </LinearGradient>
            </View>
          </View>

          {/* Team Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="people" size={24} color="#8B5CF6" />
              <Text style={styles.sectionTitle}>Meet the Team</Text>
            </View>
            
            {teamMembers.map((member, index) => (
              <View key={index} style={styles.teamCard}>
                <LinearGradient
                  colors={['#1f293780', '#11182780']}
                  style={styles.teamCardGradient}
                >
                  <View style={[styles.memberIcon, { backgroundColor: member.iconBg }]}>
                    <Ionicons name={member.icon} size={32} color={member.iconColor} />
                  </View>
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>{member.name}</Text>
                    <Text style={styles.memberRole}>{member.role}</Text>
                  </View>
                </LinearGradient>
              </View>
            ))}
          </View>

          {/* Features Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="checkmark-circle" size={24} color="#10B981" />
              <Text style={styles.sectionTitle}>What We Offer</Text>
            </View>
            
            <View style={styles.featuresGrid}>
              {[
                { icon: 'analytics', title: 'Real-time Monitoring', color: '#3B82F6' },
                { icon: 'notifications', title: 'Smart Alerts', color: '#F59E0B' },
                { icon: 'stats-chart', title: 'Usage Analytics', color: '#10B981' },
                { icon: 'water', title: 'Valve Control', color: '#06b6d4' },
              ].map((feature, index) => (
                <View key={index} style={styles.featureCard}>
                  <LinearGradient
                    colors={[`${feature.color}20`, `${feature.color}10`]}
                    style={styles.featureGradient}
                  >
                    <Ionicons name={feature.icon} size={28} color={feature.color} />
                    <Text style={styles.featureText}>{feature.title}</Text>
                  </LinearGradient>
                </View>
              ))}
            </View>
          </View>

          {/* Contact Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="mail" size={24} color="#EF4444" />
              <Text style={styles.sectionTitle}>Get in Touch</Text>
            </View>
            
            <View style={styles.contactCard}>
              <LinearGradient
                colors={['#1f293780', '#11182780']}
                style={styles.contactGradient}
              >
                <View style={styles.contactItem}>
                  <Ionicons name="mail-outline" size={20} color="#06b6d4" />
                  <Text style={styles.contactText}>info@aquatrackx.lk</Text>
                </View>
                <View style={styles.contactItem}>
                  <Ionicons name="location-outline" size={20} color="#06b6d4" />
                  <Text style={styles.contactText}>Colombo, Sri Lanka</Text>
                </View>
              </LinearGradient>
            </View>
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>
              © 2024 AquaTrackX. All rights reserved.
            </Text>
            <Text style={styles.versionText}>Version 1.0.0</Text>
          </View>

          <View style={{ height: 40 }} />
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
  
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1f293780',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#37415140',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  placeholder: {
    width: 40,
  },
  
  scrollContent: {
    padding: 20,
  },
  
  // Logo Section - Circular Format without background
  logoSection: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoContainer: {
    width: 140,
    height: 140,
    borderRadius: 70,
    overflow: 'hidden',
    marginBottom: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: '100%',
    height: '100%',
  },
  companyName: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#ffffffff',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  tagline: {
    fontSize: 16,
    color: '#9ca3af',
    textAlign: 'center',
  },
  
  // Section
  section: {
    marginBottom: 32,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginLeft: 12,
  },
  
  // Mission Card
  missionCard: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  missionGradient: {
    padding: 20,
    borderWidth: 1,
    borderColor: '#37415140',
    borderRadius: 16,
  },
  missionText: {
    fontSize: 16,
    color: '#d1d5db',
    lineHeight: 24,
  },
  
  // Team Cards
  teamCard: {
    marginBottom: 12,
    borderRadius: 16,
    overflow: 'hidden',
  },
  teamCardGradient: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#37415140',
    borderRadius: 16,
  },
  memberIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    borderWidth: 1,
    borderColor: '#37415140',
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  memberRole: {
    fontSize: 14,
    color: '#9ca3af',
  },
  
  // Features Grid
  featuresGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  featureCard: {
    width: '48%',
    borderRadius: 12,
    overflow: 'hidden',
  },
  featureGradient: {
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#37415140',
    borderRadius: 12,
    minHeight: 100,
    justifyContent: 'center',
  },
  featureText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
    marginTop: 8,
    textAlign: 'center',
  },
  
  // Contact Card
  contactCard: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  contactGradient: {
    padding: 20,
    borderWidth: 1,
    borderColor: '#37415140',
    borderRadius: 16,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  contactText: {
    fontSize: 15,
    color: '#d1d5db',
    marginLeft: 12,
  },
  
  // Footer
  footer: {
    alignItems: 'center',
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#37415140',
  },
  footerText: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 4,
  },
  versionText: {
    fontSize: 12,
    color: '#4B5563',
  },
});

export default AboutScreen;