// The web version is for watching. Making your own idea and filming new chapters happen on
// Fire TV, so on the web those choices say so instead of asking for Sparks.
let watchOnly = false;

export function setWatchOnly(value: boolean): void {
  watchOnly = value;
}

export function isWatchOnly(): boolean {
  return watchOnly;
}

export const ON_FIRE_TV = 'Available on Fire TV';
