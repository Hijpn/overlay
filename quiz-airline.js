"use strict";

const QuizAirline = (function () {
  const airlines = {
    JAL: "Japan Airlines", ANA: "All Nippon Airways", EVA: "EVA Air",
    CAL: "China Airlines", FDA: "Fuji Dream Airlines", SKY: "Skymark",
    ADO: "Air Do", SNJ: "Solaseed Air", SFJ: "StarFlyer",
    APJ: "Peach Aviation", JJP: "Jetstar Japan", KAL: "Korean Air",
    AAR: "Asiana Airlines", CPA: "Cathay Pacific", SIA: "Singapore Airlines",
    THA: "Thai Airways", UAL: "United Airlines", DAL: "Delta Air Lines",
    AAL: "American Airlines"
  };
  const defaultColor = "#38bdf8";
  const themes = ["flight-deck", "liquid-glass", "glassmorphism", "aurora", "minimal-atc", "lime", "cockpit-green", "orange", "airline", "sky-stations"];

  function readSettings(snapshot) {
    const settings = snapshot.exists() ? snapshot.val() : {};
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      throw new Error("Invalid airline settings.");
    }
    const custom = Object.prototype.hasOwnProperty.call(settings, "customAirlines") ? settings.customAirlines : {};
    if (!custom || typeof custom !== "object" || Array.isArray(custom)) {
      throw new Error("Invalid custom airlines.");
    }
    const names = Object.assign(Object.create(null), airlines);
    Object.keys(custom).forEach(function (key) {
      const name = custom[key];
      if (!key || /[.#$\[\]\/\x00-\x1f\x7f]/.test(key) ||
          Object.prototype.hasOwnProperty.call(airlines, key) ||
          typeof name !== "string" || !name.trim() || name.length > 80) {
        throw new Error("Invalid custom airline.");
      }
      names[key] = name.trim();
    });
    const selected = Object.prototype.hasOwnProperty.call(settings, "selected") ? settings.selected : "JAL";
    if (typeof selected !== "string" || !Object.prototype.hasOwnProperty.call(names, selected)) {
      throw new Error("Invalid selected airline.");
    }
    const colors = Object.prototype.hasOwnProperty.call(settings, "colors") ? settings.colors : {};
    if (!colors || typeof colors !== "object" || Array.isArray(colors)) {
      throw new Error("Invalid airline colors.");
    }
    const color = Object.prototype.hasOwnProperty.call(colors, selected) ? colors[selected] : defaultColor;
    if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) {
      throw new Error("Invalid color for " + selected + ".");
    }
    const backgrounds = Object.prototype.hasOwnProperty.call(settings, "backgroundColors") ? settings.backgroundColors : {};
    if (!backgrounds || typeof backgrounds !== "object" || Array.isArray(backgrounds)) {
      throw new Error("Invalid airline background colors.");
    }
    const background = Object.prototype.hasOwnProperty.call(backgrounds, selected)
      ? backgrounds[selected] : null;
    if (background !== null && (typeof background !== "string" || !/^#[0-9a-f]{6}$/i.test(background))) {
      throw new Error("Invalid background color for " + selected + ".");
    }
    return { selected: selected, color: color, background: background, name: names[selected], names: names };
  }

  function normalizeHex(value) {
    const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
    if (!match) return null;
    const hex = match[1].toLowerCase();
    return "#" + (hex.length === 3 ? hex.split("").map(function (char) { return char + char; }).join("") : hex);
  }

  function textColor(background) {
    if (!background) return "#eaf5f6";
    const channels = [1, 3, 5].map(function (index) {
      const channel = parseInt(background.slice(index, index + 2), 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
    const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    return luminance > 0.179 ? "#000000" : "#ffffff";
  }

  function listen(ref, render, reportError) {
    ref.on("value", function (snapshot) {
      try {
        render(readSettings(snapshot));
      } catch (error) {
        reportError(error);
      }
    }, reportError);
  }

  function createControl(select, nameInput, addButton, colorInput, colorHex, backgroundInput, backgroundHex, feedback) {
    let ref = null;
    let connected = false;
    let settings = null;
    let adding = false;
    let namesSignature = "";

    function setFeedback(message, error) {
      feedback.textContent = message;
      feedback.className = "feedback" + (error ? " error" : "");
    }

    function updateControls() {
      select.disabled = !connected || !settings;
      nameInput.disabled = !connected || !settings || adding;
      addButton.disabled = !connected || !settings || adding;
      colorInput.disabled = !connected || !settings;
      colorHex.disabled = !connected || !settings;
      backgroundInput.disabled = !connected || !settings;
      backgroundHex.disabled = !connected || !settings;
    }

    function render(value) {
      settings = value;
      const signature = JSON.stringify(value.names);
      if (signature !== namesSignature) {
        select.replaceChildren();
        Object.keys(value.names).forEach(function (code) {
          const option = document.createElement("option");
          option.value = code;
          option.textContent = value.names[code] + (Object.prototype.hasOwnProperty.call(airlines, code) ? " (" + code + ")" : "");
          select.appendChild(option);
        });
        namesSignature = signature;
      }
      select.value = value.selected;
      colorInput.value = value.color;
      colorHex.value = value.color;
      backgroundInput.value = value.background || "#07131c";
      backgroundHex.value = value.background || "";
      updateControls();
      setFeedback("Airline and custom colors sync with both quiz overlays.");
    }

    function reportError(error) {
      console.error("Quiz airline settings error:", error);
      setFeedback("Could not sync airline settings: " + error.message, true);
    }

    function save(path, value) {
      if (!connected || !ref || !settings) {
        if (settings) render(settings);
        setFeedback("Connect to Firebase before changing airline settings.", true);
        return;
      }
      ref.child(path).set(value).catch(function (error) {
        if (settings) render(settings);
        reportError(error);
      });
    }

    select.addEventListener("change", function () {
      if (!settings || !Object.prototype.hasOwnProperty.call(settings.names, select.value)) {
        reportError(new Error("Choose a valid airline."));
        return;
      }
      save("selected", select.value);
    });
    function addAirline() {
      if (!connected || !ref || !settings || adding) {
        setFeedback("Connect to Firebase before adding an airline.", true);
        return;
      }
      const name = nameInput.value.trim();
      if (!name || name.length > 80) {
        setFeedback("Enter an airline name of up to 80 characters.", true);
        return;
      }
      if (Object.keys(settings.names).some(function (key) {
        return settings.names[key].toLocaleLowerCase() === name.toLocaleLowerCase();
      })) {
        setFeedback("This airline is already in the list. Select it to change its colors.", true);
        return;
      }
      const key = ref.child("customAirlines").push().key;
      adding = true;
      updateControls();
      ref.update({ ["customAirlines/" + key]: name, selected: key }).then(function () {
        nameInput.value = "";
      }).catch(reportError).finally(function () {
        adding = false;
        updateControls();
      });
    }
    addButton.addEventListener("click", addAirline);
    nameInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        addAirline();
      }
    });
    colorInput.addEventListener("change", function () {
      if (settings) save("colors/" + settings.selected, colorInput.value);
    });
    backgroundInput.addEventListener("change", function () {
      if (settings) save("backgroundColors/" + settings.selected, backgroundInput.value);
    });
    [
      [colorHex, "colors", false],
      [backgroundHex, "backgroundColors", true]
    ].forEach(function (entry) {
      const input = entry[0];
      input.addEventListener("change", function () {
        if (!settings) return;
        const value = input.value.trim();
        if (!value && entry[2]) {
          save(entry[1] + "/" + settings.selected, null);
          return;
        }
        const hex = normalizeHex(value);
        if (!hex) {
          setFeedback("Enter a valid HEX color, for example #123456 or #abc.", true);
          return;
        }
        save(entry[1] + "/" + settings.selected, hex);
      });
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          input.blur();
        }
      });
    });

    return {
      connect: function (databaseRef) {
        ref = databaseRef;
        listen(ref, render, reportError);
      },
      setConnected: function (value) {
        connected = value;
        updateControls();
      }
    };
  }

  function connectOverlay(ref, element, label) {
    listen(ref, function (settings) {
      element.style.setProperty("--airline-color", settings.color);
      if (settings.background) element.style.setProperty("--airline-background", settings.background);
      else element.style.removeProperty("--airline-background");
      element.style.setProperty("--airline-ink", textColor(settings.background));
      label.textContent = settings.name;
    }, function (error) {
      console.error("Quiz airline settings error:", error);
    });
  }

  return { themes: themes, createControl: createControl, connectOverlay: connectOverlay };
}());
