import { ErrorBoundary } from '@/ui/components/ErrorBoundary';
import React from 'react';
import { Linking, StyleSheet, View, Pressable } from 'react-native';
import Typography from './Typography';
import Button from '../new/Button';
import Icon from './Icon';
import { Papicons } from '@getpapillon/papicons';
import { useRouter } from 'expo-router';
import { SCOLA_BRAND } from '@/constants/scolaBrand';

type MainTabErrorBoundaryProps = {
  children: React.ReactNode;
};

const MainTabErrorFallback = ({ error, reset }: { error: Error | null; reset: () => void }) => {
  const router = useRouter();
  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retour à l’accueil"
        onPress={() => router.canGoBack() ? router.back() : router.replace("/")}
        style={styles.backButton}
      >
        <Papicons name="ArrowLeft" size={24} color={SCOLA_BRAND.blue} />
      </Pressable>
      <Icon size={52} fill='white'>
        <Papicons name='alertCircle' />
      </Icon>

      <Typography color='white' variant='h4' align='center'>Mince ! Quelque chose s'est vraiment très mal passé.</Typography>
      <Typography color='#FFFFFF99' variant='body1' align='center'>Veuillez relancer l'application. Si cela continue, contactez-nous via le support.</Typography>

      {__DEV__ && error && (
        <Typography color='#FFFFFF99' variant='caption' align='center' numberOfLines={3} selectable>
          {error.message}
        </Typography>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={reset}
        style={styles.retryButton}
      >
        <Typography color="white" variant="body1" weight="semibold">Réessayer</Typography>
      </Pressable>

      <Button
        color='#FFFFFF'
        variant='secondary'
        fullWidth
        onPress={() => {
          Linking.openURL('https://docs.papillon.bzh/support')
        }}
        style={{ marginTop: 8 }}
        label={`Centre d'aide`}
      />
    </View>
  );
};

export default function MainTabErrorBoundary({ children }: MainTabErrorBoundaryProps) {
  return (
    <ErrorBoundary fallback={({ error, reset }) => <MainTabErrorFallback error={error} reset={reset} />}>
      {children}
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: SCOLA_BRAND.navy,
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
  retryButton: {
    minHeight: 48,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    borderRadius: 24,
    backgroundColor: SCOLA_BRAND.blue,
  },
});
