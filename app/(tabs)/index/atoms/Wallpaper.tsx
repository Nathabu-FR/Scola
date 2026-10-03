import MaskedView from '@react-native-masked-view/masked-view';
import { File, Paths } from 'expo-file-system';
import React, { useEffect, useState } from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from 'expo-router/react-navigation';

import { useSettingsStore } from '@/stores/settings';

const Wallpaper = ({ height = 400, dim = true }) => {
  try {
    const settingsStore = useSettingsStore(state => state.personalization);
    const { colors } = useTheme();
    const currentWallpaper = settingsStore.wallpaper;

    const [image, setImage] = useState<string | null>(null);
    const [imageAttempt, setImageAttempt] = useState(0);

    useEffect(() => {
      setImageAttempt(0);
      if (currentWallpaper?.dataUri) {
        setImage(currentWallpaper.dataUri);
        return;
      }
      if (currentWallpaper?.path?.name) {
        const file = new File(Paths.document, currentWallpaper.path.directory || '', currentWallpaper.path.name);
        if (file.exists) {
          setImage(file.uri);
        } else {
          setImage(null);
        }
      }
      else if (currentWallpaper?.url) {
        setImage(currentWallpaper.url);
      } else {
        setImage(null);
      }
    }, [currentWallpaper]);

    const thumbnail = currentWallpaper?.thumbnail;
    const imageSource = imageAttempt === 0
      ? image
        ? { uri: image }
        : thumbnail
          ? { uri: thumbnail }
          : require('@/assets/images/wallpapers/clouds.jpg')
      : imageAttempt === 1 && thumbnail
        ? { uri: thumbnail }
        : require('@/assets/images/wallpapers/clouds.jpg');

    const wallpaperImage = (
      <>
        <Image
          source={imageSource}
          onError={() => setImageAttempt(attempt => Math.min(attempt + 1, 2))}
          resizeMode="cover"
          style={[styles.image, { height }]}
        />

        {dim &&
          <LinearGradient
            colors={['rgba(0, 0, 0, 0.7)', 'rgba(0, 0, 0, 0)']}
            locations={[0, 1]}
            style={[styles.dimGradient, { height: height / 2 }]}
          />
        }
      </>
    );

    if (Platform.OS === 'web') {
      return (
        <View style={[styles.container, { height }]}>
          {wallpaperImage}
          <LinearGradient
            pointerEvents="none"
            colors={['transparent', colors.overground]}
            locations={[0, 1]}
            style={[styles.webFade, { top: height * 0.45, height: height * 0.55 }]}
          />
        </View>
      );
    }

    return (
      <MaskedView
        style={[styles.container, { height }]}
        maskElement={
          <LinearGradient
            colors={['rgba(0, 0, 0, 1)', 'rgba(0, 0, 0, 0)']}
            locations={[0.5, 1]}
            style={{ width: '100%', height }}
          />
        }
      >
        {wallpaperImage}
      </MaskedView>
    );
  } catch (error) {
    console.log(error);
    return null;
  }
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 0,
    pointerEvents: 'none' 
  },
  image: {
    width: '100%',
    position: 'absolute',
    top: 0,
    left: 0
  },
  dimGradient: {
    width: '100%',
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 1
  },
  webFade: {
    position: 'absolute',
    left: 0,
    right: 0,
  }
});

export default Wallpaper;
