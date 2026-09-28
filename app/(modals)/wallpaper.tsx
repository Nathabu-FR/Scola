import { TipIds } from "@/constants/Tips"
import { useAccountStore } from "@/stores/account"
import { retireTip } from "@/stores/tips"
import { useSettingsStore } from "@/stores/settings"
import { Wallpaper } from "@/stores/settings/types"
import AnimatedPressable from "@/ui/components/AnimatedPressable"
import Stack from "@/ui/components/Stack"
import Typography from "@/ui/components/Typography"
import { useHeaderHeight, useTheme } from "expo-router/react-navigation"
import React, { useEffect, useState } from "react"
import { FlatList, Image, Platform, Pressable, RefreshControl, View } from "react-native"
import { File, Directory, Paths } from 'expo-file-system';
import ActivityIndicator from "@/components/ActivityIndicator"
import { NativeHeaderPressable, NativeHeaderSide } from "@/ui/components/NativeHeader"
import Icon from "@/ui/components/Icon"
import { router } from "expo-router";
import { Papicons } from "@getpapillon/papicons"
import { t } from "i18next";

import * as ImagePicker from 'expo-image-picker';
import ActionMenu from "@/ui/components/ActionMenu"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Button from "@/ui/new/Button"
import TypographyNew from "@/ui/new/Typography"

const COLLECTIONS_SOURCE = "https://raw.githubusercontent.com/PapillonApp/datasets/refs/heads/main/wallpapers/index.json";

interface Collection {
  name: string;
  icon?: string;
  link?: string;
  images: Wallpaper[];
}

const WallpaperModal = () => {
  const { colors } = useTheme()
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const [collections, setCollections] = useState<Collection[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCollections = async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      const response = await fetch(COLLECTIONS_SOURCE);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setCollections(data);
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Impossible de charger les fonds d’écran.");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchCollections();
  }, []);

  // Getting here is the whole point of the home tip pointing at the palette
  // button, however the user got here. Retire it rather than leave it waiting
  // to be closed by hand.
  useEffect(() => {
    retireTip(TipIds.homeWallpaper);
  }, []);



  const [currentlyDownloading, setCurrentlyDownloading] = useState<string[]>([]);

  const settingsStore = useSettingsStore(state => state.personalization);
  const mutateProperty = useSettingsStore(state => state.mutateProperty);

  const currentWallpaper = settingsStore.wallpaper;
  const selectedId = currentWallpaper?.id;
  const hasCustomWallpaper = selectedId?.startsWith("custom:") ?? false;

  const flatListRef = React.useRef<FlatList>(null);

  useEffect(() => {
    if (collections.length > 0 && currentWallpaper) {
      const collectionIndex = collections.findIndex((collection) => collection.images.find((image) => image.id === currentWallpaper.id));
      if (collectionIndex !== -1) {
        setTimeout(() => {
          flatListRef.current?.scrollToIndex({
            index: collectionIndex,
            animated: true,
            viewOffset: Platform.OS === "ios" ? headerHeight : 0,
          });
        }, 10);
      }
    }
  }, [collections, currentWallpaper, headerHeight]);

  const wallpaperDirectory = Platform.OS === "web"
    ? null
    : new Directory(Paths.document, "wallpapers");

  const downloadAndSelect = (wallpaper: Wallpaper) => {
    if (Platform.OS === "web") {
      mutateProperty("personalization", {
        wallpaper: {
          id: wallpaper.id,
          url: wallpaper.url,
          thumbnail: wallpaper.thumbnail,
          credit: wallpaper.credit,
        },
      });
      return;
    }

    const fileName = `${wallpaper.id}.jpg`;

    const directory = wallpaperDirectory!;
    const wallpaperFile = new File(directory, fileName);
    if (wallpaperFile.exists) {
      mutateProperty("personalization", {
        wallpaper: {
          id: wallpaper.id,
          path: {
            directory: directory.name,
            name: wallpaperFile.name
          }
        }
      })
      return;
    }

    setCurrentlyDownloading((prev) => [...prev, wallpaper.id]);

    if (!directory.exists) {
      directory.create();
    }
    File.downloadFileAsync(wallpaper.url!, wallpaperFile).then((result) => {
      mutateProperty("personalization", {
        wallpaper: {
          id: wallpaper.id,
          path: {
            directory: directory.name,
            name: result.name
          }
        }
      })
    }).finally(() => {
      setCurrentlyDownloading((prev) => prev.filter((id) => id !== wallpaper.id));
    })
  }

  const uploadCustomWallpaper = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [4, 3],
        quality: 1,
        base64: Platform.OS === "web",
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      const wallpaperId = `custom:${Date.now()}`;
      if (Platform.OS === "web") {
        if (!asset.base64) {
          setError("Le navigateur n’a pas pu lire cette image. Essaie un autre fichier.");
          return;
        }
        mutateProperty("personalization", {
          wallpaper: {
            id: wallpaperId,
            dataUri: `data:${asset.mimeType || "image/jpeg"};base64,${asset.base64}`,
          },
        });
        setError(null);
        return;
      }

        const sourceFile = new File(asset.uri);

        const directory = wallpaperDirectory!;
        if (!directory.exists) {
          directory.create();
        }

        const newFileName = `${wallpaperId}.jpg`;
        const destFile = new File(directory, newFileName);

        sourceFile.copy(destFile);

        mutateProperty("personalization", {
          wallpaper: {
            id: wallpaperId,
            path: {
              directory: directory.name,
              name: destFile.name
            }
          }
        });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Impossible d’ajouter cette image.");
    }
  }

  return (
    <>
      <FlatList
        ref={flatListRef}
        data={collections}
        style={{
          flex: 1,
        }}
        contentContainerStyle={{
          gap: 16,
          paddingTop: Platform.OS === 'android' ? 20 : 0,
          paddingBottom: insets.bottom
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchCollections(true)} />}
        ListHeaderComponent={Platform.OS === "web" ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 16, gap: 8 }}>
            <Button label="Choisir une image sur cet ordinateur" onPress={uploadCustomWallpaper} />
            {error ? <TypographyNew variant="body2" color="textSecondary">{error}</TypographyNew> : null}
          </View>
        ) : error ? (
          <TypographyNew variant="body2" color="textSecondary" style={{ margin: 16 }}>{error}</TypographyNew>
        ) : null}
        ListEmptyComponent={collections.length === 0 ? (
          <View style={{ alignItems: "center", paddingHorizontal: 24, paddingVertical: 28, gap: 12 }}>
            <TypographyNew variant="body2" color="textSecondary" align="center">
              {error ? "Les fonds en ligne sont indisponibles pour le moment." : "Aucun fond d’écran à afficher."}
            </TypographyNew>
            <Button label="Réessayer" variant="secondary" onPress={() => fetchCollections(true)} />
            {Platform.OS !== "web" && <Button label="Choisir une image" variant="secondary" onPress={uploadCustomWallpaper} />}
          </View>
        ) : null}
        renderItem={({ item, index }) => (
          <View>
            <Stack direction="horizontal" alignItems="center" gap={8} padding={[16, 10]}>
              {item.icon &&
                <Image
                  source={{ uri: item.icon }}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6
                  }}
                />
              }

              <Typography style={{ flex: 1 }} variant="body1" color="text">{item.name}</Typography>

              {item.images.find((image) => image.id === currentWallpaper?.id) && item.images.find((image) => image.id === currentWallpaper?.id)?.credit &&
                <Typography variant="caption" color="secondary">{item.images.find((image) => image.id === currentWallpaper?.id)?.credit}</Typography>
              }
            </Stack>

            <FlatList
              data={item.images}
              horizontal
              style={{
                width: "100%",
                paddingHorizontal: 12
              }}
              contentContainerStyle={{
                gap: 6,
                paddingRight: 12
              }}
              showsHorizontalScrollIndicator={false}
              renderItem={({ item }) => <WallpaperImage item={item} onPress={() => downloadAndSelect(item)} selectedId={currentWallpaper?.id} isDownloading={currentlyDownloading.includes(item.id)} />}
              getItemLayout={(data, index) => (
                { length: 160 + 6, offset: (160 + 6) * index, index }
              )}
              initialScrollIndex={item.images.findIndex((image) => image.id === currentWallpaper?.id) !== -1 ? item.images.findIndex((image) => image.id === currentWallpaper?.id) : undefined}
            />
          </View>
        )}
        contentInsetAdjustmentBehavior="automatic"
      />

      <NativeHeaderSide side="Left" key={currentWallpaper?.id + ":" + "upload:" + (hasCustomWallpaper ? "true" : "false")}>
        {Platform.OS === 'android' ? (
          <NativeHeaderPressable onPress={() => router.back()}>
            <Icon size={28}>
              <Papicons name="Cross" />
            </Icon>
          </NativeHeaderPressable>
        ) : (
          <NativeHeaderPressable onPress={() => uploadCustomWallpaper()}>
            <Icon size={28} fill={hasCustomWallpaper ? colors.primary : undefined}>
              <Papicons name="Gallery" />
            </Icon>
          </NativeHeaderPressable>
        )}
      </NativeHeaderSide>

      <NativeHeaderSide side="Right" key={currentWallpaper?.id + ":" + (wallpaperDirectory?.exists ?? false)}>
        {Platform.OS === 'android' && (
          <NativeHeaderPressable onPress={() => uploadCustomWallpaper()}>
            <Icon size={28} fill={hasCustomWallpaper ? colors.primary : undefined}>
              <Papicons name="Gallery" />
            </Icon>
          </NativeHeaderPressable>
        )}
        <ActionMenu
          actions={Platform.OS === "web" ? [
            {
              id: "background:clear",
              title: t("Modal_Wallpaper_Clear"),
              imageColor: "#FF0000",
              attributes: { "destructive": true, "disabled": !currentWallpaper }
            },
          ] : [
            {
              id: "background:clear",
              title: t("Modal_Wallpaper_Clear"),
              imageColor: "#FF0000",
              image: Platform.select({
                ios: "trash.fill"
              }),
              attributes: { "destructive": true, "disabled": !currentWallpaper }
            },
            {
              id: "background:downloads",
              title: t("Modal_Wallpaper_Downloads"),
              imageColor: colors.text,
              image: Platform.select({
                ios: "square.and.arrow.down"
              }),
              displayInline: false,
              subactions: [
                {
                  title: t("Modal_Wallpaper_Downloads_Size"),
                  subtitle: ((wallpaperDirectory!.info().size ?? 0) / (1024 * 1024)).toFixed(2) + " MB"
                },
                {
                  id: "downloads:clear",
                  title: t("Modal_Wallpaper_ClearDownloads"),
                  imageColor: "#FF0000",
                  image: Platform.select({
                    ios: "trash.fill"
                  }),
                  attributes: { "destructive": true, "disabled": !wallpaperDirectory!.exists }
                }
              ]
            },
          ]}
          placement="below"
          onPressAction={({ nativeEvent }) => {
            const action = nativeEvent.event;
            if (action === "downloads:clear") {
              wallpaperDirectory!.delete();
              mutateProperty("personalization", {
                wallpaper: undefined
              })
            }
            if (action === "background:clear") {
              mutateProperty("personalization", {
                wallpaper: undefined
              })
            }
          }}
        >
          <NativeHeaderPressable>
            <Icon size={28}>
              <Papicons name="Gears" />
            </Icon>
          </NativeHeaderPressable>
        </ActionMenu>
      </NativeHeaderSide>
    </>
  )
}

const WallpaperImage = ({ item, onPress, selectedId, isDownloading }: { item: WallpaperCollection, onPress: () => void, selectedId: string, isDownloading: boolean }) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const { colors } = useTheme();

  return (

    <Pressable
      onPress={onPress}
    >
      <View
        style={{
          width: 160,
          height: 100,
          padding: 2,
          borderRadius: 16,
          borderCurve: "continuous",
          borderWidth: selectedId === item.id ? 2 : 0,
          borderColor: selectedId === item.id ? colors.primary : "transparent"
        }}
        key={item.id}
      >
        {
          (!imageLoaded || isDownloading) &&
          <View
            style={{
              position: "absolute",
              top: 2,
              left: 2,
              width: "100%",
              height: "100%",
              justifyContent: "center",
              alignItems: "center",
              zIndex: 1,
              borderRadius: 12,
              backgroundColor: "rgba(0, 0, 0, 0.5)"
            }}
          >
            <ActivityIndicator color="#ffffff" />
          </View>
        }

        <Image
          source={{ uri: item.thumbnail || item.url }}
          style={{ width: "100%", height: "100%", borderRadius: 12 }}
          onLoad={() => setImageLoaded(true)}
        />
      </View>
    </Pressable>
  );
};

export default WallpaperModal
