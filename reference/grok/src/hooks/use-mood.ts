import { useEffect } from "react";
import { useStudio, type Mood } from "@/lib/store";

export function useMood(mood: Mood) {
  const setMood = useStudio((s) => s.setMood);
  useEffect(() => {
    setMood(mood);
  }, [mood, setMood]);
}
