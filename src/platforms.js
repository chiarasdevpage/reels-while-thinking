export const platforms = Object.freeze({
  instagram: { label: 'Instagram Reels', kind: 'feed', supportsAutoScroll: true, url: 'https://www.instagram.com/reels/', routes: '^/(reels|reel)(/|$)' },
  youtube: { label: 'YouTube Shorts', kind: 'feed', supportsAutoScroll: true, url: 'https://www.youtube.com/shorts/', routes: '^/shorts(/|$)' },
  tiktok: { label: 'TikTok', kind: 'feed', supportsAutoScroll: true, url: 'https://www.tiktok.com/foryou', routes: '^/(foryou/?$|following/?$|@[^/]+/video/)' },
  subwaySurfers: { label: 'Subway Surfers', kind: 'looping-video', supportsAutoScroll: false, routes: '^/gameplay\\.html$' },
});

export const isGameplay = platform => platforms[platform]?.kind === 'looping-video';
export function resolveTarget(platform, config) {
  return isGameplay(platform) ? `http://127.0.0.1:${config.controlPort}/gameplay.html` : platforms[platform]?.url || config.targetUrl;
}

export function scrollGuard(platform, targetUrl) {
  const adapter = platforms[platform];
  if (isGameplay(platform)) return 'false';
  return `(() => {
    const active = document.activeElement;
    if (active && (['INPUT','TEXTAREA','SELECT'].includes(active.tagName) || active.isContentEditable)) return false;
    if (Array.from(document.querySelectorAll('[role="dialog"],dialog[open]')).some(el => el.getClientRects().length)) return false;
    const target = new URL(${JSON.stringify(adapter?.url || targetUrl)});
    if (location.origin !== target.origin) return false;
    if (${adapter ? `!new RegExp(${JSON.stringify(adapter.routes)}).test(location.pathname)` : '!location.pathname.startsWith(target.pathname)'}) return false;
    return Array.from(document.querySelectorAll('video')).some(v => {
      if (${Boolean(adapter)} && (!v.currentSrc || v.readyState < 2)) return false;
      const r = v.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    });
  })()`;
}

export const advanceKeys = [
  { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 },
  { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 },
];
