import { Course as SharedCourse } from '@/services/shared/timetable';

import { convertMultipleEvents } from './event-converter';
import { convertICalEventToSharedCourse } from './event-converter';
import { filterEventsByWeek } from './event-filter';
import { getAllIcals, updateProviderIfUnknown } from './ical-database';
import { detectProvider } from './ical-utils';
import { parseICalString } from './parsers/ical-event-parser';
import { appFetch } from '@/utils/network/fetch';

export interface ICalEvent {
  uid: string;
  summary?: string;
  description?: string;
  dtstart?: Date;
  dtend?: Date;
  location?: string;
  allday?: boolean;
  organizer?: string;
}

export interface ParsedICalData {
  events: ICalEvent[];
  calendarName?: string;
  isADE: boolean;
  isHyperplanning: boolean;
  provider?: string;
  url?: string;
  isSchool?: boolean;
  schoolName?: string;
}

/** Google Calendar's embed page is HTML; turn public embeds into their ICS feed. */
export function normalizeICalFeedUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (
    parsed.hostname.toLowerCase() === 'calendar.google.com' &&
    parsed.pathname.replace(/\/+$/, '').endsWith('/calendar/embed')
  ) {
    const calendarId = parsed.searchParams.get('src');
    if (!calendarId) {
      throw new Error('Ce lien Google Calendar ne contient pas de calendrier à importer.');
    }
    return `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
  }
  return parsed.toString();
}

export async function fetchAndParseICal(url: string): Promise<ParsedICalData> {
  try {
    const feedUrl = normalizeICalFeedUrl(url);
    const response = await appFetch(feedUrl, {
      // Google ICS : certains agendas privés exigent un UA navigateur,
      // sinon Google répond 403/HTML au client Rust.
      headers: { "User-Agent": "Mozilla/5.0 Scola/1.0" },
    });
    if (!response.ok) {
      if (response.status === 400 || response.status === 404) {
        throw new Error("Ce lien iCal est invalide ou n'est plus partagé (vérifie le partage public du calendrier).");
      }
      if (response.status === 403) {
        throw new Error("Accès refusé au calendrier : utilise l'adresse secrète iCal (partage privé) plutôt que l'URL publique/embed.");
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const icalString = await response.text();
    // Google renvoie la page HTML d'embed quand on lui donne l'URL /embed :
    // si on reçoit du HTML, l'URL n'a pas été normalisée en flux ICS.
    if (contentType.includes("text/html") || /<\s*html[\s>]/i.test(icalString.slice(0, 2000))) {
      throw new Error("Ce lien renvoie une page web, pas un flux iCal. Pour Google Agenda, utilise l'adresse iCal (…/basic.ics) ou l'adresse secrète, pas l'URL /embed.");
    }
    const { events, metadata } = parseICalString(icalString);
    const { isADE, isHyperplanning, provider, isSchool, schoolName } = detectProvider(metadata.prodId, url);
    return {
      events,
      calendarName: metadata.calendarName,
      isADE,
      isHyperplanning,
      provider,
      url: feedUrl,
      isSchool,
      schoolName
    };
  } catch (error) {
    console.error('Error fetching or parsing iCal:', error);
    throw error;
  }
}

async function processIcalData(ical: any): Promise<{ parsedData: ParsedICalData; shouldUpdateIcal: boolean }> {
  const parsedData = await fetchAndParseICal(ical.url);
  let shouldUpdateIcal = false;

  if (!ical.provider || ical.provider === 'unknown') {
    await updateProviderIfUnknown(ical, parsedData.provider || 'unknown');
    shouldUpdateIcal = true;
  }

  return { parsedData, shouldUpdateIcal };
}

function withSavedManualStatus(course: SharedCourse): SharedCourse {
  if (typeof window === "undefined") return course;
  try {
    const status = window.localStorage.getItem(`ical-course-status:${course.id}`);
    return status ? { ...course, manualStatus: status } : course;
  } catch {
    return course;
  }
}

export async function getICalEventsForWeek(weekStart: Date, weekEnd: Date): Promise<SharedCourse[]> {
  const icals = await getAllIcals();
  const allEvents: SharedCourse[] = [];

  for (const ical of icals) {
    try {
      const { parsedData } = await processIcalData(ical);
      const weekEvents = filterEventsByWeek(parsedData.events, weekStart, weekEnd);
      const convertedEvents = convertMultipleEvents(weekEvents, {
        icalId: ical.id,
        icalTitle: ical.title,
        isADE: parsedData.isADE,
        isHyperplanning: parsedData.isHyperplanning,
        intelligentParsing: (ical as any).intelligentParsing || false,
        isSchool: parsedData.isSchool ?? false,
        schoolName: parsedData.schoolName
      });

      allEvents.push(...convertedEvents.map(withSavedManualStatus));
    } catch (error) {
      console.error(`Error processing iCal ${ical.title}:`, error);
    }
  }

  return allEvents;
}

export async function getICalCourseById(id: string): Promise<SharedCourse | undefined> {
  const icals = await getAllIcals();

  for (const ical of icals) {
    try {
      const { parsedData } = await processIcalData(ical);
      const event = parsedData.events.find(candidate => candidate.uid === id);
      if (event) {
        return withSavedManualStatus(convertICalEventToSharedCourse(event, {
          icalId: ical.id,
          icalTitle: ical.title,
          isADE: parsedData.isADE,
          isHyperplanning: parsedData.isHyperplanning,
          intelligentParsing: (ical as any).intelligentParsing || false,
          isSchool: parsedData.isSchool ?? false,
          schoolName: parsedData.schoolName,
        }));
      }
    } catch (error) {
      console.error(`Error processing iCal ${ical.title}:`, error);
    }
  }

  return undefined;
}
