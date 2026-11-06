  (() => {
    const cards = [...document.querySelectorAll(".record-card")];
    const inlineHost = document.getElementById("spotify-inline");
    const embedTarget = document.getElementById("spotify-embed");

    let iframeApi = null;
    let controller = null;
    let controllerReady = false;
    let loadedButton = null;
    let activeButton = null;
    let activeCard = null;
    let pendingButton = null;

    const spotifyValue = button => (button?.dataset.spotifyUrl || "").trim();

    const isSpotifyTrack = value =>
      /^https:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]+/i.test(value) ||
      /^spotify:track:[A-Za-z0-9]+$/i.test(value);

    const trackId = value => {
      const urlMatch = value.match(/\/track\/([A-Za-z0-9]+)/i);
      const uriMatch = value.match(/^spotify:track:([A-Za-z0-9]+)$/i);
      return (urlMatch || uriMatch || [])[1] || "";
    };

    const spotifyWebUrl = value => {
      if (/^https:\/\//i.test(value)) return value;
      const id = trackId(value);
      return id ? `https://open.spotify.com/track/${id}` : "#";
    };

    const getCardText = card => ({
      artist: card.querySelector(".record-artist")?.textContent.trim() || "Artist",
      title: card.querySelector(".record-title")?.textContent.trim() || "Track"
    });

    const setArtwork = (card, url) => {
      if (!url) return;
      const image = card.querySelector(".track-art");
      const { artist, title } = getCardText(card);

      image.onload = () => {
        image.hidden = false;
      };
      image.onerror = () => {
        image.hidden = true;
      };
      image.alt = `${artist} - ${title} cover artwork`;
      image.src = url;
    };

    const loadArtwork = async card => {
      const manualArtwork = (card.dataset.artworkUrl || "").trim();
      if (manualArtwork) {
        setArtwork(card, manualArtwork);
        return;
      }

      const button = card.querySelector(".track-play");
      const value = spotifyValue(button);
      if (!isSpotifyTrack(value)) return;

      try {
        const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyWebUrl(value))}`);
        if (!response.ok) return;
        const data = await response.json();
        if (data.thumbnail_url) setArtwork(card, data.thumbnail_url);
      } catch (_) {
        // Artwork is optional if the request fails.
      }
    };

    const setButtonState = (button, state) => {
      if (!button) return;
      const label = button.querySelector(".track-play-label");
      const isPlaying = state === "playing";
      const isLoading = state === "loading";

      button.classList.toggle("is-playing", isPlaying);
      button.classList.toggle("is-loading", isLoading);
      button.setAttribute("aria-pressed", String(isPlaying));

      if (label) label.textContent = isPlaying ? "Pause" : isLoading ? "Loading" : "Play";
    };

    const clearCardState = card => {
      if (!card) return;
      card.classList.remove("is-active");
      card.style.setProperty("--track-progress", "0%");
    };

    const ensurePlayerHost = () => {
      inlineHost.hidden = false;
    };

    const markActive = (button, card, state = "loading") => {
      if (activeButton && activeButton !== button) setButtonState(activeButton, "paused");
      if (activeCard && activeCard !== card) clearCardState(activeCard);

      activeButton = button;
      activeCard = card;
      card.classList.add("is-active");
      setButtonState(button, state);
      ensurePlayerHost();
    };

    const bindController = () => {
      controller.addListener("ready", () => {
        controllerReady = true;

        if (pendingButton) {
          const queued = pendingButton;
          pendingButton = null;

          if (queued !== loadedButton) {
            controller.loadEntity(`spotify:track:${trackId(spotifyValue(queued))}`);
            loadedButton = queued;
          }

          controller.play();
          setButtonState(queued, "loading");
        }
      });

      controller.addListener("playback_started", event => {
        const playingId = trackId(event?.data?.playingURI || "");
        if (!activeButton || (playingId && playingId !== trackId(spotifyValue(activeButton)))) return;
        setButtonState(activeButton, "playing");
      });

      controller.addListener("playback_update", event => {
        if (!activeButton || !activeCard || !event?.data) return;

        const playingId = trackId(event.data.playingURI || "");
        const activeId = trackId(spotifyValue(activeButton));
        if (playingId && activeId && playingId !== activeId) return;

        const { isPaused, isBuffering, duration, position } = event.data;

        if (isBuffering) setButtonState(activeButton, "loading");
        else if (isPaused) setButtonState(activeButton, "paused");
        else setButtonState(activeButton, "playing");

        if (Number.isFinite(duration) && duration > 0 && Number.isFinite(position)) {
          const progress = Math.max(0, Math.min(100, (position / duration) * 100));
          activeCard.style.setProperty("--track-progress", `${progress}%`);
          if (position >= duration - 250) activeCard.style.setProperty("--track-progress", "0%");
        }
      });
    };

    const createController = button => {
      if (!iframeApi || controller || !button) return;

      const value = spotifyValue(button);
      if (!isSpotifyTrack(value)) return;

      loadedButton = button;
      pendingButton = button;
      embedTarget.replaceChildren();

      iframeApi.createController(
        embedTarget,
        { width: 300, height: 152, uri: `spotify:track:${trackId(value)}` },
        embedController => {
          controller = embedController;
          bindController();
        }
      );
    };

    const playTrack = button => {
      const value = spotifyValue(button);
      if (!isSpotifyTrack(value)) return;

      const card = button.closest(".record-card");

      const isLoadedTrack = button === loadedButton;
      const isCurrentlyPlaying = isLoadedTrack && button.classList.contains("is-playing");

      if (controller && controllerReady && isLoadedTrack) {
        if (activeCard && activeCard !== card) clearCardState(activeCard);
        if (activeButton && activeButton !== button) setButtonState(activeButton, "paused");

        activeButton = button;
        activeCard = card;
        card.classList.add("is-active");
        ensurePlayerHost();

        if (isCurrentlyPlaying) {
          setButtonState(button, "paused");
          controller.pause();
        } else {
          setButtonState(button, "loading");
          controller.play();
        }
        return;
      }

      markActive(button, card, "loading");

      if (!controller) {
        if (!iframeApi) {
          pendingButton = button;
          return;
        }
        createController(button);
        return;
      }

      if (!controllerReady) {
        pendingButton = button;
        return;
      }

      if (loadedButton && loadedButton !== button) controller.pause();

      controller.loadEntity(`spotify:track:${trackId(value)}`);
      loadedButton = button;
      controller.play();
    };

    cards.forEach(card => {
      const button = card.querySelector(".track-play");
      const spotifyLink = card.querySelector(".spotify-link");
      const value = spotifyValue(button);

      if (isSpotifyTrack(value)) {
        spotifyLink.href = spotifyWebUrl(value);
        button.title = "Play on Spotify";
      } else {
        button.setAttribute("aria-disabled", "true");
        button.title = "Add a Spotify track URL to data-spotify-url";
      }

      button.addEventListener("click", () => {
        if (!isSpotifyTrack(spotifyValue(button))) return;
        playTrack(button);
      });

      loadArtwork(card);
    });

    window.onSpotifyIframeApiReady = api => {
      iframeApi = api;

      if (pendingButton && !controller) createController(pendingButton);
    };
  })();

  document.querySelectorAll(".year").forEach(element => {
  element.textContent = new Date().getFullYear();
  });

