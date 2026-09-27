import { useAccountStore } from "@/stores/account";
import { cleanSubjectName, getSubjectFormat } from "./utils";

export { cleanSubjectName };

export function getSubjectName(subject: string): string {
  // See getSubjectEmoji: don't persist an entry for a blank subject.
  if (!subject || !subject.trim()) {
    return subject;
  }

  const cleanedName = cleanSubjectName(subject);
  const lastUsedAccount = useAccountStore.getState().lastUsedAccount;
  const subjectProperties = useAccountStore
    .getState()
    .accounts.find(a => a.id === lastUsedAccount)?.customisation?.subjects[
    cleanedName
  ];
  if (subjectProperties && subjectProperties.name !== "") {
    return subjectProperties.name;
  }

  const foundFormat = getSubjectFormat(subject);

  const prettyName = foundFormat?.pretty || subject;
  setTimeout(() => {
    useAccountStore.getState().setSubjectName(cleanedName, prettyName);
  }, 0);
  return prettyName;
}
