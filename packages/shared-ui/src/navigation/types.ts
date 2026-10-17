import type { Audience, Mood } from '@storyquest/contracts';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';

export interface StoryOrigin {
  ideaId: string | null;
  prompt?: string;
  moods?: Mood[];
  audience?: Audience;
}

export type RootStackParamList = {
  Home: undefined;
  Create: undefined;
  Story: {
    storyId: string;
    title: string;
    nodeId: string;
    posterUrl: string | null;
    origin: StoryOrigin;
  };
  End: {
    storyId: string;
    title: string;
    stillUrl: string | null;
    origin: StoryOrigin;
  };
  Movie: {
    url: string;
    title: string;
    posterUrl: string | null;
  };
};

export type ScreenNavigation<T extends keyof RootStackParamList> = NativeStackNavigationProp<RootStackParamList, T>;
export type ScreenRoute<T extends keyof RootStackParamList> = RouteProp<RootStackParamList, T>;
