import { canOpenURL } from "expo-linking";
import * as Location from "expo-location";

import { AvailableTransportServices } from "@/constants/AvailableTransportServices";
import { TransportAddress, TransportStorage } from "@/stores/account/types";
import { log } from "@/utils/logger/logger";

export const initializeTransport = async (address: string | undefined): Promise<TransportStorage> => {
  let defaultApp = 'google_maps'; //We use Google Maps because it's a weblink !

  // Sur Tauri desktop canOpenURL/geocode n'existent pas : l'ancien code
  // rejetait et le bouton « Initialiser sans adresse » semblait mort.
  // On dégrade proprement : pas de géoloc sur desktop, adresse conservée.
  try {
    for (const service of AvailableTransportServices) {
      try {
        if (await canOpenURL(service.baseUrlScheme)) {
          defaultApp = service.id;
          break;
        }
      } catch (error) {
        log(`Can't open a transport app: ${service.baseUrlScheme}`);
      }
    }
  } catch {
    // canOpenURL indisponible hors mobile : on garde google_maps.
  }

  let permissionGranted = false;
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    permissionGranted = permission.granted;
  } catch {
    permissionGranted = false;
  }
  let schoolAddress: TransportAddress | undefined = undefined;

  if (address !== undefined && address !== null) {
    if (permissionGranted) {
      try {
        const geocodes = await Location.geocodeAsync(address);
        if (geocodes.length > 0) {
          const geocode = geocodes[0];
          schoolAddress = {
            firstTitle: address,
            secondTitle: "",
            address,
            longitude: geocode.longitude,
            latitude: geocode.latitude
          };
        }
      } catch {
        // Géocodage indisponible (desktop) : on garde l'adresse brute.
      }
    }
    schoolAddress ??= {
      firstTitle: address,
      secondTitle: "",
      address,
      longitude: -1,
      latitude: -1,
    };
  }

  return {
    enabled: permissionGranted || schoolAddress !== undefined,
    defaultApp,
    homeAddress: {
      firstTitle: "current_location",
      secondTitle: "current_location",
      address: "current_location",
      longitude: -1,
      latitude: -1,
    },
    schoolAddress,
  };
}
