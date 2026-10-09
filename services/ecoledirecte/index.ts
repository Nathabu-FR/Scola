import { Client } from "@blockshub/blocksdirecte";

import { Auth, Services } from "@/stores/account/types";
import { error } from "@/utils/logger/logger";

import { Attendance } from "../shared/attendance";
import { Period, PeriodGrades } from "../shared/grade";
import { Chat, Message, Recipient } from "../shared/chat";
import { Homework } from "../shared/homework";
import { News } from "../shared/news";
import { CourseDay } from "../shared/timetable";
import { Capabilities, SchoolServicePlugin } from "../shared/types";
import { fetchEDAttendance, fetchEDAttendancePeriods } from "./attendance";
import { fetchEDChatMessages, fetchEDChats } from "./chat";
import { fetchEDGradePeriods, fetchEDGrades } from "./grades";
import { fetchEDHomeworks, setEDHomeworkAsDone } from "./homework";
import { fetchEDNews } from "./news";
import { refreshEDAccount } from "./refresh";
import { fetchEDTimetable } from "./timetable";

export class EcoleDirecte implements SchoolServicePlugin {
  displayName = "EcoleDirecte";
  service = Services.ECOLEDIRECTE;
  capabilities: Capabilities[] = [
    Capabilities.REFRESH, 
    Capabilities.NEWS, 
    Capabilities.ATTENDANCE, 
    Capabilities.ATTENDANCE_PERIODS,
    Capabilities.GRADES,
    Capabilities.HOMEWORK,
    Capabilities.TIMETABLE,
    Capabilities.CHAT_READ
  ];
  session: Client | undefined;
  authData: Auth = {};

  constructor(public accountId: string) {}

  async refreshAccount(credentials: Auth): Promise<EcoleDirecte> {
    const refresh = (await refreshEDAccount(this.accountId, credentials, this.session))

    this.authData = refresh.auth
    this.session = refresh.account

    return this;
  }

  async getHomeworks(weekNumber: number): Promise<Homework[]> {
    if (this.session) {
      return fetchEDHomeworks(this.session, this.accountId, weekNumber);
    }

    throw error("Session or account is not valid", "EcoleDirecte.getHomeworks")
  }

  async getChats(): Promise<Chat[]> {
    if (this.session) {
      return fetchEDChats(this.session, this.accountId);
    }

    throw error("Session or account is not valid", "EcoleDirecte.getChats");
  }

  async getChatRecipients(chat: Chat): Promise<Recipient[]> {
    return chat.creator ? [{ id: chat.creator, name: chat.creator }] : [];
  }

  async getChatMessages(chat: Chat): Promise<Message[]> {
    if (this.session) {
      return fetchEDChatMessages(this.session, chat);
    }

    throw error("Session or account is not valid", "EcoleDirecte.getChatMessages");
  }

  async getNews(): Promise<News[]> {
    if (this.session) {
      return fetchEDNews(this.session, this.accountId);
    }

    throw error("Session or account is not valid", "EcoleDirecte.getNews");
  }

  async getGradesForPeriod(period: Period): Promise<PeriodGrades> {
    if (this.session) {
      return fetchEDGrades(this.session, this.accountId, period)
    }
		
    throw error("Session or account is not valid", "EcoleDirecte.getGradesForPeriod");
  }

  async getGradesPeriods(): Promise<Period[]> {
    if (this.session) {
      return fetchEDGradePeriods(this.session, this.accountId)
    }
		
    throw error("Session or account is not valid", "EcoleDirecte.getGradesPeriods");
  }

  async getAttendanceForPeriod(period: string): Promise<Attendance> {
    if (this.session) {
      return fetchEDAttendance(this.session, this.accountId, period);
    }

    throw error("Session or account is not valid", "EcoleDirecte.getAttendanceForPeriod");
  }

  async getAttendancePeriods(): Promise<Period[]> {
    if (this.session) {
      return fetchEDAttendancePeriods(this.session, this.accountId);
    }

    throw error("Session or account is not valid", "EcoleDirecte.getAttendancePeriods");
  }

  async getWeeklyTimetable(weekNumber: number, date: Date): Promise<CourseDay[]> {
    if (this.session) {
      return fetchEDTimetable(this.session, this.accountId, weekNumber, date)
    }

    throw error("Session or account is not valid", "EcoleDirecte.getWeeklyTimetable")
  }

  async setHomeworkCompletion(homework: Homework, state?: boolean): Promise<Homework> {
    if (this.session) {
      return setEDHomeworkAsDone(this.session, homework, state)
    }

    throw error("Session or account is not valid", "EcoleDirecte.setHomeworkCompletion");
  }
}
