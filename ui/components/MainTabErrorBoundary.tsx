import { ErrorBoundary } from '@/ui/components/ErrorBoundary';
import React from 'react';
import { Linking, StyleSheet, View, Pressable } from 'react-native';
import Typography from './Typography';
import Button from '../new/Button';
import Icon from './Icon';
import { Papicons } from '@getpapillon/papicons';
import { useRouter } from 'expo-router';

type MainTabErrorBoundaryProps = {
  children: React.ReactNode;
};

const MainTabErrorFallback = () => {
  const router = useRouter();
  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retour à l’accueil"
        onPress={() => router.canGoBack() ? router.back() : router.replace("/")}
        style={styles.backButton}
      >
        <Papicons name="ArrowLeft" size={24} color="#8B5CF6" />
      </Pressable>
      <Icon size={52} fill='white'>
        <Papicons name='alertCircle' />
      </Icon>

      <Typography color='white' variant='h4' align='center'>Mince ! Quelque chose s'est vraiment très mal passé.</Typography>
      <Typography color='#FFFFFF99' variant='body1' align='center'>Veuillez relancer l'application. Si cela continue, contactez-nous via le support.</Typography>

      <Button
        color='#FFFFFF'
        variant='secondary'
        fullWidth
        onPress={() => {
          Linking.openURL('https://docs.papillon.bzh/support')
        }}
        style={{ marginTop: 16 }}
        label={`Centre d'aide`}
      />
    </View>
  );
};

export default function MainTabErrorBoundary({ children }: MainTabErrorBoundaryProps) {
  return (
    <ErrorBoundary fallback={<MainTabErrorFallback />}>
      {children}
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: '#29947A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    paddingVertical: 16,
    gap: 6,
  },
  backButton: {
    position: 'absolute',
    top: 18,
    left: 18,
    zIndex: 2,
    width: 42,
    height: 42,
    borderRadius: 24,
    backgroundColor: '#FFFFFF26',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
