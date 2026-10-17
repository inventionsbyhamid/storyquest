import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { IComponentInstance, useKeplerAppStateManager } from '@amazon-devices/react-native-kepler';
import { KeplerVideoSurfaceView, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import { AppOverrideMediaControlHandler } from '../../utils/AppOverrideMediaControlHandler.kepler';
import { useLatest } from '../../hooks/useLatest';
import type { ClipPlayerProps } from './types';

const DEINIT_TIMEOUT_MS = 1500;

type Handlers = Record<string, () => void>;

// One W3C player per Story screen. Each clip switches `src` on the same player so only one
// decoder is ever alive. If a switch fails the player is rebuilt once and the clip retried.
class ClipController {
  private player: VideoPlayer | null = null;
  private ready = false;
  private destroyed = false;
  private surface: string | null = null;
  private source: string | null = null;
  private wanted: string | null = null;
  private paused = true;
  private metadataLoaded = false;
  private started = false;
  private ended = false;
  private retriedSource: string | null = null;
  private hasLoadedBefore = false;
  private componentInstance: IComponentInstance | undefined;
  private readonly handlers: Handlers;

  constructor(
    private readonly props: () => ClipPlayerProps,
    private readonly onFirstMetadata: () => void,
  ) {
    this.handlers = {
      loadedmetadata: this.onLoadedMetadata,
      canplay: this.applyPaused,
      playing: this.onPlaying,
      timeupdate: this.onTimeUpdate,
      ended: this.onEnded,
      error: this.onError,
    };
  }

  async start(componentInstance?: IComponentInstance) {
    this.componentInstance = componentInstance;
    const player = new VideoPlayer();
    this.player = player;
    try {
      if (componentInstance) {
        try {
          await player.setMediaControlFocus(
            componentInstance,
            new AppOverrideMediaControlHandler((command) => this.props().onMediaCommand?.(command)),
          );
        } catch (error) {
          console.warn('[ClipPlayer] media controls unavailable', error);
        }
      }
      await player.initialize();
      if (this.destroyed || this.player !== player) {
        this.teardown(player);
        return;
      }
      player.autoplay = false;
      Object.keys(this.handlers).forEach((type) => player.addEventListener(type, this.handlers[type]));
      this.ready = true;
      if (this.surface) player.setSurfaceHandle(this.surface);
      if (this.wanted) this.load(this.wanted);
    } catch (error) {
      console.error('[ClipPlayer] could not start the player', error);
      if (this.wanted) this.props().onError?.(this.wanted, 'Video player could not start');
    }
  }

  load(src: string) {
    this.wanted = src;
    const player = this.player;
    if (!player || !this.ready || this.destroyed) return;
    if (this.retriedSource !== src) this.retriedSource = null;
    this.source = src;
    this.metadataLoaded = false;
    this.started = false;
    this.ended = false;
    try {
      if (this.hasLoadedBefore) player.pause();
      player.src = src;
      player.load();
      this.hasLoadedBefore = true;
    } catch (error) {
      console.error('[ClipPlayer] load failed', error);
      this.onError();
    }
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    this.applyPaused();
  }

  setSurface(handle: string) {
    this.surface = handle;
    if (this.player && this.ready) {
      this.player.setSurfaceHandle(handle);
      this.applyPaused();
    }
  }

  clearSurface(handle: string) {
    if (this.player && this.ready) {
      try {
        this.player.clearSurfaceHandle(handle);
      } catch {
        // The surface is already gone.
      }
    }
    if (this.surface === handle) this.surface = null;
  }

  destroy() {
    this.destroyed = true;
    const player = this.player;
    this.player = null;
    this.ready = false;
    if (player) this.teardown(player);
  }

  private teardown(player: VideoPlayer) {
    Object.keys(this.handlers).forEach((type) => player.removeEventListener(type, this.handlers[type]));
    try {
      player.pause();
    } catch {
      // Ignore, we are tearing down.
    }
    if (this.surface) {
      try {
        player.clearSurfaceHandle(this.surface);
      } catch {
        // Ignore, we are tearing down.
      }
    }
    try {
      const status = player.deinitializeSync(DEINIT_TIMEOUT_MS);
      if (status !== 'success') console.warn('[ClipPlayer] deinitialize returned', status);
    } catch (error) {
      console.warn('[ClipPlayer] deinitialize failed', error);
    }
  }

  private applyPaused = () => {
    const player = this.player;
    if (!player || !this.ready || !this.source || !this.metadataLoaded || this.ended) return;
    try {
      if (this.paused) {
        if (!player.paused) player.pause();
      } else if (this.surface && player.paused) {
        player.play();
      }
    } catch (error) {
      console.warn('[ClipPlayer] play state change failed', error);
    }
  };

  private onLoadedMetadata = () => {
    if (!this.source) return;
    const firstTime = !this.metadataLoaded;
    this.metadataLoaded = true;
    if (firstTime) {
      this.props().onReady?.(this.source);
      this.onFirstMetadata();
    }
    this.applyPaused();
  };

  private onPlaying = () => {
    if (!this.source || this.started) return;
    this.started = true;
    this.props().onPlaying?.(this.source);
  };

  private onTimeUpdate = () => {
    const player = this.player;
    if (!player || !this.source) return;
    const time = player.currentTime || 0;
    if (!this.started && time > 0) this.onPlaying();
    this.props().onProgress?.(time, player.duration || 0);
  };

  private onEnded = () => {
    if (!this.source || this.ended) return;
    this.ended = true;
    this.props().onEnded?.(this.source);
  };

  private onError = () => {
    const src = this.source;
    if (!src) return;
    if (this.retriedSource !== src && !this.destroyed) {
      this.retriedSource = src;
      this.rebuild(src);
      return;
    }
    this.props().onError?.(src, 'Playback failed');
  };

  private rebuild(src: string) {
    const old = this.player;
    this.player = null;
    this.ready = false;
    this.hasLoadedBefore = false;
    if (old) this.teardown(old);
    this.wanted = src;
    this.start(this.componentInstance);
  }
}

function ClipPlayer(props: ClipPlayerProps) {
  const latest = useLatest(props);
  const appState = useKeplerAppStateManager();
  const [surfaceMounted, setSurfaceMounted] = useState(false);
  const controllerRef = useRef<ClipController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new ClipController(
      () => latest.current,
      () => setSurfaceMounted(true),
    );
  }

  useEffect(() => {
    const controller = controllerRef.current!;
    let instance: IComponentInstance | undefined;
    try {
      instance = appState.getComponentInstance();
    } catch {
      instance = undefined;
    }
    controller.start(instance);
    return () => controller.destroy();
    // The player lives exactly as long as this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    controllerRef.current!.setPaused(props.paused);
  }, [props.paused]);

  useEffect(() => {
    if (props.source) controllerRef.current!.load(props.source);
  }, [props.source]);

  const onSurfaceViewCreated = useCallback((handle: string) => controllerRef.current?.setSurface(handle), []);
  const onSurfaceViewDestroyed = useCallback((handle: string) => controllerRef.current?.clearSurface(handle), []);

  return (
    <View style={props.style} pointerEvents="none">
      {surfaceMounted && (
        <KeplerVideoSurfaceView
          style={styles.surface}
          onSurfaceViewCreated={onSurfaceViewCreated}
          onSurfaceViewDestroyed={onSurfaceViewDestroyed}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    zIndex: 0,
  },
});

export default React.memo(ClipPlayer);
