import { useEffect } from 'react';
import { useRoute } from './router';
import StartScreen from './components/StartScreen';
import HomeScreen from './components/HomeScreen';
import DirectoryScreen from './components/DirectoryScreen';
import PreviewScreen from './components/PreviewScreen';
import QuizScreen from './components/QuizScreen';
import ResultScreen from './components/ResultScreen';
import WrongWordsScreen from './components/WrongWordsScreen';
import WordListScreen from './components/WordListScreen';
import WordDetailScreen from './components/WordDetailScreen';
import DailyScreen from './components/DailyScreen';
import SettingsScreen from './components/SettingsScreen';
import { useApp } from './state/AppContext';

export default function App() {
  const [route] = useRoute();
  const { store } = useApp();

  // 动画开关全局生效
  useEffect(() => {
    document.body.classList.toggle('no-anim', !store.settings.animationOn);
  }, [store.settings.animationOn]);

  let screen: React.ReactNode;
  switch (route.name) {
    case 'start':
      screen = <StartScreen />;
      break;
    case 'home':
      screen = <HomeScreen />;
      break;
    case 'directory':
      screen = <DirectoryScreen initialDay={route.day} />;
      break;
    case 'preview':
      screen = <PreviewScreen unitId={route.unitId} />;
      break;
    case 'quiz':
      screen = <QuizScreen unitId={route.unitId} />;
      break;
    case 'result':
      screen = <ResultScreen unitId={route.unitId} />;
      break;
    case 'wrong':
      screen = <WrongWordsScreen />;
      break;
    case 'words':
      screen = <WordListScreen />;
      break;
    case 'word':
      screen = <WordDetailScreen wordId={route.wordId} />;
      break;
    case 'daily':
      screen = <DailyScreen initialTab={route.tab} />;
      break;
    case 'settings':
      screen = <SettingsScreen />;
      break;
  }

  return <div className="app">{screen}</div>;
}
