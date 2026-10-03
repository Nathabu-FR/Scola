import { useMemo } from 'react';

import { useAccountStore } from '@/stores/account';
import { getInitials } from '@/utils/chats/initials';

export const useUserProfileData = () => {
  const lastUsedAccount = useAccountStore((state) => state.lastUsedAccount);
  const accountExists = useAccountStore(state => state.accounts.some(account => account.id === state.lastUsedAccount));
  const firstName = useAccountStore(state => state.accounts.find(account => account.id === state.lastUsedAccount)?.firstName ?? null);
  const lastName = useAccountStore(state => state.accounts.find(account => account.id === state.lastUsedAccount)?.lastName ?? null);
  const level = useAccountStore(state => state.accounts.find(account => account.id === state.lastUsedAccount)?.className ?? null);
  const establishment = useAccountStore(state => state.accounts.find(account => account.id === state.lastUsedAccount)?.schoolName ?? null);
  const profilePictureData = useAccountStore(state => state.accounts.find(account => account.id === state.lastUsedAccount)?.customisation?.profilePicture);

  const initials = useMemo(() => getInitials(`${firstName ?? ""} ${lastName ?? ""}`), [firstName, lastName]);

  const profilePicture = useMemo(() => {
    if (profilePictureData && !profilePictureData.startsWith("PCFET0NUWVBFIGh0bWw+")) {
      return `data:image/png;base64,${profilePictureData}`;
    }
    return undefined;
  }, [profilePictureData]);

  if (!accountExists || !lastUsedAccount) {return null;}

  return {
    firstName,
    lastName,
    level,
    establishment,
    initials,
    profilePicture
  };
};
