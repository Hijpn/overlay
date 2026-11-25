function parseQuizCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  text = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
        closedQuote = true;
      } else {
        field += char;
      }
    } else if (char === "," || char === "\n" || char === "\r") {
      row.push(field);
      field = "";
      closedQuote = false;
      if (char !== ",") {
        rows.push(row);
        row = [];
        if (char === "\r" && text[i + 1] === "\n") i += 1;
      }
    } else if (char === '"' && field === "" && !closedQuote) {
      quoted = true;
    } else {
      if (char === '"' || closedQuote) throw new Error("Invalid CSV quoting.");
      field += char;
    }
  }
  if (quoted) throw new Error("Unclosed quoted field in CSV.");
  if (field !== "" || row.length || closedQuote) {
    row.push(field);
    rows.push(row);
  }
  const nonEmptyRows = rows.map(function (cells, index) {
    return { cells: cells, number: index + 1 };
  }).filter(function (row) {
    return row.cells.some(function (cell) { return cell.trim() !== ""; });
  });
  if (!nonEmptyRows.length) throw new Error("The CSV is empty.");
  const headers = nonEmptyRows[0].cells.map(function (header) { return header.trim().toLowerCase(); });
  const required = ["question", "answer1", "answer2", "answer3", "answer4", "correct"];
  if (new Set(headers).size !== headers.length || required.some(function (header) { return !headers.includes(header); }) ||
      headers.some(function (header) { return !required.includes(header) && header !== "explanation"; })) {
    throw new Error("CSV headers must be question, answer1, answer2, answer3, answer4, correct, and optionally explanation.");
  }
  if (nonEmptyRows.length === 1) throw new Error("The CSV has no questions.");
  return nonEmptyRows.slice(1).map(function (row) {
    const cells = row.cells;
    if (cells.length !== headers.length) throw new Error("CSV row " + row.number + " has the wrong number of columns.");
    const get = function (name) {
      const position = headers.indexOf(name);
      return position < 0 ? "" : cells[position].trim();
    };
    const correct = get("correct");
    const item = {
      question: get("question"),
      answers: [get("answer1"), get("answer2"), get("answer3"), get("answer4")],
      correctIndex: /^[1-4]$/.test(correct) ? Number(correct) - 1 : -1,
      explanation: get("explanation")
    };
    if (!isValidQuizQuestion(item)) throw new Error("Invalid question in CSV row " + row.number + ". Check text lengths, answers and correct (1–4).");
    return item;
  });
}

function isValidQuizQuestion(item) {
  return item && typeof item.question === "string" && item.question.trim().length > 0 &&
    item.question.length <= 240 && Array.isArray(item.answers) && item.answers.length === 4 &&
    item.answers.every(function (answer) { return typeof answer === "string" && answer.trim().length > 0 && answer.length <= 100; }) &&
    Number.isInteger(item.correctIndex) && item.correctIndex >= 0 && item.correctIndex < 4 &&
    typeof item.explanation === "string" && item.explanation.length <= 240;
}

function createQuizLibrary() {
  const select = document.getElementById("saved-question");
  const save = document.getElementById("save-question");
  const remove = document.getElementById("delete-question");
  const file = document.getElementById("csv-file");
  const loadSynced = document.getElementById("load-synced-question");
  const feedback = document.getElementById("library-feedback");
  let ref = null;
  let selectionRef = null;
  let connected = false;
  let ready = false;
  let selectionReady = false;
  let busy = false;
  let questions = {};
  let selectedKey = null;
  let appliedKey = "";
  let appliedItem = null;
  let loadedForm = null;
  let ignoredSelection;
  let initialized = false;

  function message(text, kind) {
    feedback.textContent = text;
    feedback.className = "feedback" + (kind ? " " + kind : "");
  }

  function updateButtons() {
    const unavailable = !connected || !ready || !selectionReady || busy;
    select.disabled = unavailable;
    save.disabled = unavailable;
    file.disabled = unavailable;
    remove.disabled = unavailable || !select.value;
    loadSynced.disabled = unavailable || !selectedKey || !questions[selectedKey];
  }

  function formValues() {
    return JSON.stringify([
      document.getElementById("question").value,
      ...[0, 1, 2, 3].map(function (index) { return document.getElementById("answer-" + index).value; }),
      document.getElementById("correct-answer").value,
      document.getElementById("explanation").value,
      document.getElementById("question-number").value,
      document.getElementById("total-questions").value
    ]);
  }

  function hasUnsavedChanges() {
    if (loadedForm !== null) return formValues() !== loadedForm;
    return Boolean(document.getElementById("question").value ||
      [0, 1, 2, 3].some(function (index) { return document.getElementById("answer-" + index).value; }) ||
      document.getElementById("explanation").value);
  }

  function clearForm() {
    select.value = "";
    document.getElementById("question").value = "";
    [0, 1, 2, 3].forEach(function (index) { document.getElementById("answer-" + index).value = ""; });
    document.getElementById("correct-answer").value = "0";
    document.getElementById("explanation").value = "";
    document.getElementById("question-number").value = "1";
    document.getElementById("total-questions").value = "1";
    appliedKey = "";
    appliedItem = null;
    ignoredSelection = selectedKey;
    loadedForm = formValues();
    updateButtons();
  }

  function loadQuestion(key) {
    const item = questions[key];
    if (!item) return;
    select.value = key;
    document.getElementById("question").value = item.question;
    item.answers.forEach(function (answer, index) { document.getElementById("answer-" + index).value = answer; });
    document.getElementById("correct-answer").value = String(item.correctIndex);
    document.getElementById("explanation").value = item.explanation;
    const keys = Object.keys(questions);
    document.getElementById("question-number").value = String(Math.min(keys.indexOf(key) + 1, 999));
    document.getElementById("total-questions").value = String(Math.min(keys.length, 999));
    appliedKey = key;
    appliedItem = JSON.stringify(item);
    ignoredSelection = undefined;
    loadedForm = formValues();
    updateButtons();
  }

  function syncSelection() {
    if (!ready || !selectionReady || busy) return;
    if (!initialized) {
      initialized = true;
      if (!selectedKey && !hasUnsavedChanges()) {
        const firstKey = Object.keys(questions)[0];
        if (firstKey) loadQuestion(firstKey);
        message("Saved questions are synced between PC and mobile.");
        updateButtons();
        return;
      }
    }
    if (!appliedKey && ignoredSelection === selectedKey) return;
    if (selectedKey && !questions[selectedKey]) {
      message("The synced question is not available in the library. Your form is unchanged.", "error");
    } else if (selectedKey && (selectedKey !== appliedKey || JSON.stringify(questions[selectedKey]) !== appliedItem)) {
      if (hasUnsavedChanges()) {
        message("The other control selected or changed a question. Your unsaved form is unchanged; use Load synced question to replace it.", "error");
      } else {
        loadQuestion(selectedKey);
        message("Question synced between PC and mobile.");
      }
    } else if (!selectedKey && appliedKey && !questions[appliedKey]) {
      if (hasUnsavedChanges()) {
        message("The saved question was deleted. Your unsaved form is unchanged.", "error");
      } else {
        clearForm();
        message("The selected question was deleted.");
      }
    }
    updateButtons();
  }

  async function publishSelection(key) {
    try {
      await selectionRef.set(key);
      return true;
    } catch (error) {
      console.error("Could not sync selected question:", error);
      message("Question saved or loaded, but selection could not sync: " + error.message, "error");
      return false;
    }
  }

  function finishOperation() {
    const error = feedback.classList.contains("error") ? feedback.textContent : null;
    busy = false;
    syncSelection();
    if (error) message(error, "error");
    updateButtons();
  }

  function render(snapshot) {
    const data = snapshot.val();
    if (data !== null && (typeof data !== "object" || Array.isArray(data) ||
        Object.values(data).some(function (item) { return !isValidQuizQuestion(item); }))) {
      ready = false;
      message("Firebase returned invalid saved questions. No changes were made.", "error");
      console.error("Invalid Firebase question library:", data);
      updateButtons();
      return;
    }
    questions = data || {};
    select.replaceChildren(new Option("New question", ""));
    Object.keys(questions).forEach(function (key) {
      select.add(new Option(questions[key].question, key));
    });
    if (appliedKey && questions[appliedKey]) select.value = appliedKey;
    ready = true;
    syncSelection();
    updateButtons();
  }

  select.addEventListener("change", function () {
    const key = select.value;
    if (hasUnsavedChanges() && !window.confirm("Replace your unsaved form with the selected question?")) {
      select.value = appliedKey;
      return;
    }
    if (!key) {
      clearForm();
      return;
    }
    loadQuestion(key);
    publishSelection(key);
  });
  loadSynced.addEventListener("click", function () {
    if (!selectedKey || !questions[selectedKey]) return;
    if (hasUnsavedChanges() && !window.confirm("Replace your unsaved form with the synced question?")) return;
    loadQuestion(selectedKey);
    message("Question synced between PC and mobile.", "success");
  });
  document.getElementById("new-question").addEventListener("click", function () {
    if (hasUnsavedChanges() && !window.confirm("Discard your unsaved form?")) return;
    clearForm();
  });
  save.addEventListener("click", async function () {
    const item = {
      question: document.getElementById("question").value.trim(),
      answers: [0, 1, 2, 3].map(function (index) { return document.getElementById("answer-" + index).value.trim(); }),
      correctIndex: Number(document.getElementById("correct-answer").value),
      explanation: document.getElementById("explanation").value.trim()
    };
    if (!isValidQuizQuestion(item)) {
      message("Enter a question, four answers, and a valid correct answer before saving.", "error");
      return;
    }
    if (!connected || !ready || !selectionReady || busy) return;
    const target = select.value ? ref.child(select.value) : ref.push();
    busy = true;
    updateButtons();
    try {
      await target.set(item);
      const questionNumber = document.getElementById("question-number").value;
      const totalQuestions = document.getElementById("total-questions").value;
      loadQuestion(target.key);
      document.getElementById("question-number").value = questionNumber;
      document.getElementById("total-questions").value = totalQuestions;
      loadedForm = formValues();
      if (await publishSelection(target.key)) message("Question saved and synced.", "success");
    } catch (error) {
      console.error("Could not save question:", error);
      message("Could not save question: " + error.message, "error");
    } finally {
      finishOperation();
    }
  });
  remove.addEventListener("click", async function () {
    if (!connected || !ready || busy || !select.value) return;
    if (!window.confirm("Delete the selected saved question?")) return;
    busy = true;
    updateButtons();
    const deletedKey = select.value;
    try {
      await ref.child(deletedKey).remove();
      clearForm();
      if (selectedKey !== deletedKey || await publishSelection(null)) message("Question deleted.", "success");
    } catch (error) {
      console.error("Could not delete question:", error);
      message("Could not delete question: " + error.message, "error");
    } finally {
      finishOperation();
    }
  });
  file.addEventListener("change", async function () {
    const selectedFile = file.files[0];
    if (!selectedFile || !connected || !ready || !selectionReady || busy) return;
    const formHasContent = document.getElementById("question").value ||
      [0, 1, 2, 3].some(function (index) { return document.getElementById("answer-" + index).value; }) ||
      document.getElementById("explanation").value;
    if (formHasContent && !window.confirm("Importing will replace the current form with the first imported question. Continue?")) {
      file.value = "";
      return;
    }
    busy = true;
    updateButtons();
    try {
      if (selectedFile.size > 2 * 1024 * 1024) throw new Error("CSV must be 2 MB or smaller.");
      const items = parseQuizCsv(await selectedFile.text());
      const updates = {};
      items.forEach(function (item) { updates[ref.push().key] = item; });
      await ref.update(updates);
      const firstKey = Object.keys(updates)[0];
      if (questions[firstKey]) {
        loadQuestion(firstKey);
        if (await publishSelection(firstKey)) {
          message(items.length + " question(s) imported. The first question is ready to publish.", "success");
        }
      } else {
        message("Questions were imported, but the first question could not be loaded. Select a saved question above.", "error");
      }
    } catch (error) {
      console.error("Could not import questions:", error);
      message("Could not import CSV: " + error.message, "error");
    } finally {
      file.value = "";
      finishOperation();
    }
  });
  return {
    setConnected: function (value) { connected = value; updateButtons(); },
    connect: function (libraryRef, selectedQuestionRef) {
      ref = libraryRef;
      selectionRef = selectedQuestionRef;
      ref.on("value", render, function (error) {
        ready = false;
        message("Could not read saved questions: " + error.message, "error");
        console.error("Firebase question library listener failed:", error);
        updateButtons();
      });
      selectionRef.on("value", function (snapshot) {
        const key = snapshot.val();
        if (key !== null && (typeof key !== "string" || !key || /[.#$\[\]\/]/.test(key))) {
          selectionReady = false;
          message("Firebase returned an invalid synced question.", "error");
          console.error("Invalid synced question key:", key);
        } else {
          selectedKey = key;
          selectionReady = true;
          syncSelection();
        }
        updateButtons();
      }, function (error) {
        selectionReady = false;
        message("Could not read the synced question: " + error.message, "error");
        console.error("Firebase question selection listener failed:", error);
        updateButtons();
      });
    }
  };
}
