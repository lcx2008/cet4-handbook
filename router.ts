import { useEffect, useState } from 'react';

/** 极简 hash 路由 */
export type Route =
  | { name: 'start' }
  | { name: 'home' }
  | { name: 'directory'; day?: number }
  | { name: 'preview'; unitId: string }
  | { name: 'quiz'; unitId: string }
  | { name: 'result'; unitId: string }
  | { name: 'wrong' }
  | { name: 'words' }
  | { name: 'word'; wordId: string }
  | { name: 'daily'; tab?: 'recite' | 'news' | 'read' }
  | { name: 'settings' };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  const [head, ...rest] = h.split('/');
  switch (head) {
    case '':
      return { name: 'start' };
    case 'home':
      return { name: 'home' };
    case 'directory':
      return { name: 'directory', day: rest[0] ? Number(rest[0]) : undefined };
    case 'preview':
      return { name: 'preview', unitId: rest[0] ?? '' };
    case 'quiz':
      return { name: 'quiz', unitId: rest[0] ?? '' };
    case 'result':
      return { name: 'result', unitId: rest[0] ?? '' };
    case 'wrong':
      return { name: 'wrong' };
    case 'words':
      return { name: 'words' };
    case 'word':
      return { name: 'word', wordId: rest[0] ?? '' };
    case 'daily': {
      const tab = rest[0] === 'news' ? 'news' : rest[0] === 'read' ? 'read' : 'recite';
      return { name: 'daily', tab };
    }
    case 'settings':
      return { name: 'settings' };
    default:
      return { name: 'start' };
  }
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = (r: Route) => {
    const path = routeToHash(r);
    if (window.location.hash === path) {
      setRoute(r);
      window.scrollTo(0, 0);
    } else {
      window.location.hash = path;
    }
  };
  return [route, navigate];
}

export function routeToHash(r: Route): string {
  switch (r.name) {
    case 'start':
      return '#/';
    case 'home':
      return '#/home';
    case 'directory':
      return r.day ? `#/directory/${r.day}` : '#/directory';
    case 'preview':
      return `#/preview/${r.unitId}`;
    case 'quiz':
      return `#/quiz/${r.unitId}`;
    case 'result':
      return `#/result/${r.unitId}`;
    case 'wrong':
      return '#/wrong';
    case 'words':
      return '#/words';
    case 'word':
      return `#/word/${r.wordId}`;
    case 'daily':
      return r.tab === 'news' ? '#/daily/news' : r.tab === 'read' ? '#/daily/read' : '#/daily';
    case 'settings':
      return '#/settings';
  }
}
