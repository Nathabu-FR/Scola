import { useEffect, useState } from 'react';
import { InteractionManager, Platform } from 'react-native';
import { useSettingsStore } from "@/stores/settings";
import { predictHomework } from "@/utils/magic/prediction";
import { error } from '@/utils/logger/logger';

export const useMagicPrediction = (content: string) => {
  const [magic, setMagic] = useState<string | undefined>(undefined);
  const magicEnabled = useSettingsStore(state => state.personalization.magicEnabled);

  useEffect(() => {
    let isCancelled = false;
    if (!content || !magicEnabled) {
      setMagic(undefined);
      return;
    }

    const runPrediction = () => {
      void predictHomework(content, magicEnabled)
        .then(result => {
          if (!isCancelled) setMagic(result);
        })
        .catch(reason => {
          if (!isCancelled) error(String(reason), "useMagicPrediction");
        });
    };

    if (Platform.OS === "web") {
      runPrediction();
      return () => { isCancelled = true; };
    }

    // Let the task list paint and settle before loading/running the ML model.
    // Off-screen list rows are virtualized, so only visible homework can queue work.
    const timeoutRef: { current?: ReturnType<typeof setTimeout> } = {};
    const interaction = InteractionManager.runAfterInteractions(() => {
      timeoutRef.current = setTimeout(runPrediction, 180);
    });

    return () => {
      isCancelled = true;
      interaction.cancel();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [content, magicEnabled]);

  return magic;
};
