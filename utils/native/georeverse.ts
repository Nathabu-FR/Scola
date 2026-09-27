import { error } from "../logger/logger";
import { appFetch } from "@/utils/network/fetch";

export async function GeographicReverse(lat: number, lon: number): Promise<GeoInfo> {
  try {
    let retries = 3;
    let res: Response = new Response();

    while (retries > 0) {
      res = await appFetch(
        `https://data.geopf.fr/geocodage/reverse?lat=${lat}&lon=${lon}&limit=1&index=parcel,poi,address`
      );

      if (res.ok) {
        break;
      }

      if (res.status >= 400 && res.status < 500) {
        throw new Error(`Request rejected. Status: ${res.status}`);
      }

      retries--;

      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        throw new Error(`Failed after 3 retries. Status: ${res.status}`);
      }
    }


    if (!res.ok) {
      throw new Error(`Status: ${res.status}`);
    }

    const response = await res.json();

    const feature = response?.features?.[0];
    if (!feature?.properties?.city || !feature?.properties?.postcode) {
      throw new Error(JSON.stringify(feature));
    }

    return {
      city: feature.properties.city[0],
      postalCode: Number(feature.properties.postcode),
      longitude: feature.geometry.coordinates[0],
      latitude: feature.geometry.coordinates[1]
    };

  } catch (err) {
    error(String(err))
  }
}

export async function GeographicQuerying(q: string, retry = 3): Promise<GeoInfo> {
  try {
    let retries = retry;
    let res: Response = new Response();

    while (retries > 0) {
      res = await appFetch(
        `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}`
      );

      if (res.ok) {
        break;
      }

      if (res.status >= 400 && res.status < 500) {
        throw new Error(`Request rejected. Status: ${res.status}`);
      }

      retries--;
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        throw new Error(`Failed after 3 retries. Status: ${res.status}`);
      }
    }

    const response = await res.json();

    const feature = response?.features?.[0];
    if (!feature?.properties?.city || !feature?.properties?.postcode) {
      throw new Error(JSON.stringify(feature));
    }

    return {
      city: feature.properties.city[0],
      postalCode: Number(feature.properties.postcode),
      longitude: feature.geometry.coordinates[0],
      latitude: feature.geometry.coordinates[1]
    };

  } catch (err) {
    error(String(err))
  }
}

export async function GeographicSearchCities(q: string, retry = 3): Promise<GeoSearchCityInfo[]> {
  try {
    let retries = retry;
    let res: Response = new Response();

    while (retries > 0) {
      res = await appFetch(
        `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}`
      );

      if (res.ok) {
        break;
      }

      if (res.status >= 400 && res.status < 500) {
        throw new Error(`Request rejected. Status: ${res.status}`);
      }

      retries--;
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        throw new Error(`Failed after 3 retries. Status: ${res.status}`);
      }
    }

    const response = await res.json();

    const resp = response?.features.map((feature: any) => ({
      id: feature.properties.banId,
      city: feature.properties.city,
      context: feature.properties.context,
      importance: feature.properties.score,
      postalCode: Number(feature.properties.postcode),
      longitude: feature.geometry.coordinates[0],
      latitude: feature.geometry.coordinates[1]
    })) ?? [];

    return resp;
  } catch (err) {
    error(String(err))
  }
}

export interface GeoInfo {
  city: string;
  postalCode: number;
  latitude: number;
  longitude: number;
}

export interface GeoSearchCityInfo {
  id: string;
  city: string;
  citycode: string;
  context: string;
  importance: number;
  postalCode: number;
  latitude: number;
  longitude: number;
}

export interface UAISchoolInfo {
  uai: string;
  name: string;
  city: string;
  postalCode: number;
  latitude: number;
  longitude: number;
}

const UAI_PATTERN = /^\d{7}[a-zA-Z]$/;

export function isLikelyUAI(value: string): boolean {
  return UAI_PATTERN.test(value.trim());
}

/**
 * Resolves a French school from its UAI code (the official "numéro
 * d'établissement", 7 digits followed by a letter) using the Ministry of
 * Education's public "Annuaire de l'éducation" open data, so a school can be
 * found directly instead of only by searching a city name.
 *
 * The dataset's geographic field isn't part of its documented, stable
 * contract, so a couple of shapes are tried defensively instead of assuming
 * one - if none of them are present, this throws rather than silently
 * returning a wrong location.
 */
export async function GeographicSearchByUAI(uai: string): Promise<UAISchoolInfo> {
  const cleanedUai = uai.trim().toUpperCase();

  if (!isLikelyUAI(cleanedUai)) {
    throw new Error(`"${cleanedUai}" doesn't look like a UAI code (7 digits + 1 letter)`);
  }

  const where = encodeURIComponent(`identifiant_de_l_etablissement="${cleanedUai}"`);
  const url = `https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-annuaire-education/records?where=${where}&limit=1`;

  const res = await appFetch(url);
  if (!res.ok) {
    throw new Error(`Request rejected. Status: ${res.status}`);
  }

  const response = await res.json();
  const record = response?.results?.[0];

  if (!record) {
    throw new Error(`No school found for UAI ${cleanedUai}`);
  }

  const latitude =
    record.latitude ??
    record.position?.lat ??
    record.geo_point_2d?.lat ??
    (Array.isArray(record.position) ? record.position[0] : undefined);
  const longitude =
    record.longitude ??
    record.position?.lon ??
    record.geo_point_2d?.lon ??
    (Array.isArray(record.position) ? record.position[1] : undefined);

  if (typeof latitude !== "number" || typeof longitude !== "number") {
    throw new Error(`No known location for UAI ${cleanedUai}`);
  }

  return {
    uai: cleanedUai,
    name: record.nom_etablissement ?? cleanedUai,
    city: record.nom_commune ?? record.nom_etablissement ?? cleanedUai,
    postalCode: Number(record.code_postal) || 0,
    latitude,
    longitude,
  };
}