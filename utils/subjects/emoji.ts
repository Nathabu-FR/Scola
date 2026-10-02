import { useAccountStore } from "@/stores/account";

import { cleanSubjectName, getSubjectFormat } from "./utils";

export function getSubjectEmoji(subject: string): string {
  // An empty/blank subject (seen on some EcoleDirecte "misc" timetable or
  // homework entries that don't carry a real matière) used to still get
  // registered as a subject of its own, polluting the subject
  // personalization list with a nameless entry. Return a default without
  // persisting anything for it.
  if (!subject || !subject.trim()) {
    return "🤓";
  }

  const cleanedName = cleanSubjectName(subject);
  const lastUsedAccount = useAccountStore.getState().lastUsedAccount;
  const subjectProperties = useAccountStore
    .getState()
    .accounts.find(a => a.id === lastUsedAccount)?.customisation?.subjects[
    cleanedName
  ];
  if (subjectProperties && subjectProperties.emoji !== "") {
    return subjectProperties.emoji;
  }

  const foundFormat = getSubjectFormat(subject);

  const emoji = foundFormat?.emoji || "🤓";
  // Deferred like getSubjectColor/getSubjectName: this can be called from
  // inside another component's render (a course or homework row), and
  // writing to the store synchronously at that point risks a "cannot
  // update while rendering" React warning.
  setTimeout(() => {
    useAccountStore.getState().setSubjectEmoji(cleanedName, emoji);
  }, 0);
  return emoji;
}
