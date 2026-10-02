import { Papicons } from "@getpapillon/papicons";
import { useHeaderHeight, useTheme } from "expo-router/react-navigation";
import { useNavigation } from "expo-router";
import React, { memo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ActivityIndicator from "@/ui/components/ActivityIndicator";
import { Dynamic } from "@/ui/components/Dynamic";
import Icon from "@/ui/components/Icon";
import Search from "@/ui/components/Search";
import Stack from "@/ui/components/Stack";
import Divider from "@/ui/new/Divider";
import List from "@/ui/new/List";
import Typography from "@/ui/new/Typography";
import { GeographicSearchByUAI, GeographicSearchCities, isLikelyUAI } from "@/utils/native/georeverse";
import { useSafeHorizontalPadding } from "@/ui/hooks/useSafeHorizontalPadding";
import OnboardingStepProgress from "@/components/onboarding/OnboardingStepProgress";

const convertPostalCode
= (postalCode: string) => {
  if (postalCode.length < 5) {
    return "0" + postalCode;
  }
  return postalCode;
}

export interface School {
  name: string,
  distance: number,
  url: string
}

const PronoteSearchHeader = memo(({
  city,
  setCity,
  loading,
  showElse,
  t
}: {
  city: string,
  setCity: (text: string) => void,
  loading: boolean,
  showElse: boolean,
  t: (key: string, options?: any) => string
}) => (
  <Stack padding={[4, 0]}>
    <OnboardingStepProgress
      step={2}
      total={3}
      title={t("ONBOARDING_SEARCH_TITLE")}
      description={t("ONBOARDING_PRONOTE_LOCATION_HELP")}
    />
    <Divider height={6} ghost />
    <Search placeholder={t("ONBOARDING_METHOD_SEARCH")} style={{ width: "100%" }} value={city} setValue={setCity} onTextChange={setCity} autoFocus={city.trim().length === 0} />
    
    {loading &&
      <Dynamic animated>
        <Stack vAlign="center" hAlign="center" width={"100%"} gap={2}>
          <Divider height={18} ghost />
          <ActivityIndicator />
          <Divider height={12} ghost />
          <Typography align="center" variant="h5">{t("ONBOARDING_SCHOOLS_SEARCHING")}</Typography>
          <Typography align="center" variant="body1" color="textSecondary">{t("ONBOARDING_SCHOOLS_SEARCHING_HINT")}</Typography>
        </Stack>
      </Dynamic>
    }

    <Divider height={18} ghost />
  </Stack>
));

export default function PronoteLoginMethod() {
  const headerHeight = useHeaderHeight();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const safePadding = useSafeHorizontalPadding(16);
  const navigation = useNavigation();
  const { t } = useTranslation();

  const [city, setCity] = useState<string>("");
  const [debouncedCity, setDebouncedCity] = useState<string>("");
  const [cities, setCities] = useState<Array<School>>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [uaiStatus, setUaiStatus] = useState<"idle" | "loading" | "error">("idle");

  const looksLikeUAI = isLikelyUAI(debouncedCity);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedCity(city.trim());
    }, 350);

    return () => {
      clearTimeout(timeout);
    };
  }, [city]);

  useEffect(() => {
    setUaiStatus("idle");
  }, [debouncedCity]);

  useEffect(() => {
    if(!debouncedCity || debouncedCity.length < 3) {
      setCities([]);
      setLoading(false);
    } else {
      let canceled = false;

      setLoading(true);
      GeographicSearchCities(debouncedCity)
        .then((cities) => {
          if(canceled) {
            return;
          }
          setCities(cities.sort((a, b) => b.importance - a.importance).splice(0, 10));
        })
        .finally(() => {
          if(canceled) {
            return;
          }
          setLoading(false);
        });

      return () => {
        canceled = true;
      };
    }
  }, [debouncedCity]);

  const selectCity = (city: School) => {
    navigation.navigate(`select`, { city: city });
  }

  const searchByUAI = async () => {
    setUaiStatus("loading");
    try {
      const school = await GeographicSearchByUAI(debouncedCity);
      setUaiStatus("idle");
      navigation.navigate("select", {
        city: {
          id: school.uai,
          city: school.city,
          context: school.name,
          postalCode: school.postalCode,
          latitude: school.latitude,
          longitude: school.longitude,
        },
      });
    } catch {
      setUaiStatus("error");
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.overground }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.select({ android: 0, default: 20 })}>
      <List
        ListHeaderComponent={<PronoteSearchHeader city={city} setCity={setCity} loading={loading && cities.length === 0} showElse={cities.length === 0 && !loading} t={t} />}
        contentContainerStyle={{
          padding: 16,
          ...safePadding,
          flexGrow: 1,
          gap: 10,
          paddingTop: headerHeight + 20,
          paddingBottom: insets.bottom + 20,
        }}
        style={{ flex: 1 }}
        animated
      >
        {looksLikeUAI && (
          <List.Item animated onPress={searchByUAI} disabled={uaiStatus === "loading"}>
            <List.Leading>
              <Icon size={26}>
                {uaiStatus === "loading" ? <ActivityIndicator /> : <Papicons name="search" />}
              </Icon>
            </List.Leading>
            <Typography variant='title'>{t("ONBOARDING_PRONOTE_LOGIN_UAI", { uai: debouncedCity.toUpperCase() })}</Typography>
            <Typography variant='body1' color="textSecondary">
              {uaiStatus === "error"
                ? t("ONBOARDING_PRONOTE_LOGIN_UAI_ERROR")
                : t("ONBOARDING_PRONOTE_LOGIN_UAI_DESCRIPTION")}
            </Typography>
          </List.Item>
        )}

        {cities.length === 0 && !loading && (
          <List.Item animated onPress={() => navigation.navigate("url")}>
            <List.Leading>
              <Icon><Papicons name="link" /></Icon>
            </List.Leading>
            <Typography variant='title'>{t("ONBOARDING_PRONOTE_LOGIN_URL")}</Typography>
          </List.Item>
        )}

        {cities.map((city, i) => (
          <List.Item animated={true} key={city.id} id={city.id} onPress={() => {selectCity(city)}}>
            <List.Leading>
              <Icon><Papicons name="mappin" /></Icon>
            </List.Leading>
            <Typography variant="title">{city.city}</Typography>
            <Typography variant="body1" color="textSecondary">
              {city.context}
            </Typography>
            <List.Trailing>
              <Typography variant="body1" color="textSecondary">
                {convertPostalCode(city.postalCode.toString())}
              </Typography>
            </List.Trailing>
          </List.Item>
        ))}
      </List>
    </KeyboardAvoidingView>
  )
}
