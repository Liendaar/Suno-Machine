/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// FIX: Import useMemo for SDK initialization and correct types for API calls.
import React, { useState, useCallback, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
// FIX: Import correct types for API calls.
import { GoogleGenAI, Type, GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
  Auth,
  User
} from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, collection, query, where, getDocs, Firestore } from "firebase/firestore";

// --- Type Definitions ---
interface Artist {
  id: number;
  name: string;
  style: string;
}

interface GenerationHistoryItem {
  titles: string[];
  themes: string[];
  lyrics: string[];
}

interface GenerationHistory {
  [artistId: string]: GenerationHistoryItem;
}

// --- Hardcoded Firebase Configuration ---
const PRECONFIGURED_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCSr33LMZPgm2V6uqhedH8VVdltg4pY0OQ",
  authDomain: "suno-machine.firebaseapp.com",
  projectId: "suno-machine",
  storageBucket: "suno-machine.firebasestorage.app",
  messagingSenderId: "674054444367",
  appId: "1:674054444367:web:e013497a3db2256ddfa13a",
  measurementId: "G-NCRYVNFZDR"
};

// --- Prop Type Definitions ---
interface ManageArtistsViewProps {
  artists: Artist[];
  updateArtists: (newArtists: Artist[]) => void;
  // FIX: Use specific types for the generative AI call function.
  callGenerativeAI: (payload: GenerateContentParameters) => Promise<GenerateContentResponse>;
  generationHistory: GenerationHistory;
  updateGenerationHistory: (newHistory: GenerationHistory) => void;
}

interface CreateSongViewProps {
  artists: Artist[];
  // FIX: Use specific types for the generative AI call function.
  callGenerativeAI: (payload: GenerateContentParameters) => Promise<GenerateContentResponse>;
  generationHistory: GenerationHistory;
  updateGenerationHistory: (newHistory: GenerationHistory) => void;
}

interface AuthViewProps {
  auth: Auth;
  db: Firestore;
}

// REVERT: Re-add ProfileViewProps for user-managed API keys.
interface ProfileViewProps {
  user: User;
  apiKey: string | null;
  updateApiKey: (key: string) => Promise<void>;
}

interface ResultCardProps {
    id: string;
    title: string;
    content: string;
    onCopy: (content: string, buttonId: string) => void;
    isLarge?: boolean;
    onRegenerate?: (id: string) => void;
    isRegenerating?: boolean;
}

interface SongData {
    title: string;
    style: string;
    lyrics: string;
}

// --- Artist Management View ---
const ManageArtistsView = ({ artists, updateArtists, callGenerativeAI, generationHistory, updateGenerationHistory }: ManageArtistsViewProps) => {
  const [editingArtist, setEditingArtist] = useState<Artist | null>(null);
  const [formName, setFormName] = useState("");
  const [formStyle, setFormStyle] = useState("");
  const [formError, setFormError] = useState("");
  const [saveConfirmation, setSaveConfirmation] = useState("");
  const [aiComment, setAiComment] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (editingArtist) {
      setFormName(editingArtist.name);
      setFormStyle(editingArtist.style);
      setFormError("");
      setAiComment("");
      setSaveConfirmation("");
    } else {
      setFormName("");
      setFormStyle("");
      setFormError("");
    }
  }, [editingArtist]);

  const handleSave = () => {
    const trimmedName = formName.trim();
    const trimmedStyle = formStyle.trim();

    if (!trimmedName || !trimmedStyle) return;

    // Check for duplicate names (case-insensitive)
    const isDuplicate = artists.some(
      (artist) =>
        artist.name.toLowerCase() === trimmedName.toLowerCase() &&
        (!editingArtist || artist.id !== editingArtist.id)
    );

    if (isDuplicate) {
      setFormError(`An artist with the name "${trimmedName}" already exists.`);
      setSaveConfirmation("");
      return;
    }
    
    setFormError("");
    let newArtists: Artist[];
    let successMessage: string;
    if (editingArtist) {
      newArtists = artists.map((a) =>
          a.id === editingArtist.id ? { ...a, name: trimmedName, style: trimmedStyle } : a
        );
      successMessage = `Artist "${trimmedName}" updated successfully!`;
    } else {
      newArtists = [
        ...artists,
        { id: Date.now(), name: trimmedName, style: trimmedStyle },
      ];
      successMessage = `Artist "${trimmedName}" created successfully!`;
    }
    updateArtists(newArtists);
    setEditingArtist(null);
    setSaveConfirmation(successMessage);
    setTimeout(() => setSaveConfirmation(""), 3000);
  };

  const handleDelete = (id: number) => {
    if (window.confirm("Are you sure you want to delete this artist? This will also delete their generation history.")) {
      const newArtists = artists.filter((a) => a.id !== id);
      updateArtists(newArtists);

      const newHistory = { ...generationHistory };
      delete newHistory[String(id)];
      updateGenerationHistory(newHistory);
      
      if (editingArtist && editingArtist.id === id) {
        setEditingArtist(null);
      }
    }
  };
  
  const handleGenerateRandomArtist = async () => {
    setIsGenerating(true);
    setFormError(""); 
    if (editingArtist) {
        setEditingArtist(null);
    }
    try {
      const existingNames = artists.map(a => a.name).join(', ');
      
      let prompt = `You are an expert in music history and creative branding. Generate a completely fictional, unique, and highly creative musical artist concept. The artist's name must be unique and NOT one of the following: [${existingNames}]. The name should also be highly unlikely to belong to any known real-world artist, past or present.\n\n`;

      if (aiComment.trim()) {
          prompt += `The user has provided a specific creative direction: "${aiComment.trim()}". Please use this as a core inspiration for the generated artist.\n\n`;
      } else {
          prompt += `The core idea is to fuse two or more disparate and unconventional genres. Think outside the box.\n\n`;
      }

      prompt += `Provide a unique name and a detailed, evocative description of their musical style. The style description should be 2-3 sentences long and clearly explain the fusion of genres.\n\nFor example:\n- Name: "Abyssal Choir", Style: "A fusion of Gregorian monastery chants with deep, atmospheric glitch-hop beats. Their music feels both ancient and futuristic, echoing from the depths of a digital cathedral."\n- Name: "Sawdust & Starlight", Style: "Appalachian banjo folk music blended with ambient space-drone soundscapes. It's the sound of a lonely astronaut playing old mountain tunes in a silent starship."\n\nReturn the result as a JSON object with "name" and "style" keys.`;
      
      const payload: GenerateContentParameters = {
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: {
              responseMimeType: "application/json",
              responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                      name: { type: Type.STRING, description: "The unique name of the fictional artist." },
                      style: { type: Type.STRING, description: "A detailed description of the artist's musical style, fusing unconventional genres." },
                  },
                  required: ["name", "style"],
              },
          },
      };

      const response = await callGenerativeAI(payload);
      const responseText = response.text.trim();
      const newArtistData = JSON.parse(responseText);

      if (newArtistData.name && newArtistData.style) {
        setFormName(newArtistData.name.trim());
        setFormStyle(newArtistData.style.trim());
      } else {
        throw new Error("Invalid data format from API");
      }
    } catch (e) {
      console.error("Error generating random artist:", e);
      setFormError(e.message || "Sorry, couldn't generate an artist. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="manage-artists-view">
      <div className="form-card">
        <h3>{editingArtist ? "Edit Artist" : "Add New Artist"}</h3>
        
        <input
          type="text"
          value={formName}
          onChange={(e) => { setFormName(e.target.value); setFormError(""); setSaveConfirmation(""); }}
          placeholder="Artist Name (e.g., The Midnight)"
        />
        <textarea
          value={formStyle}
          onChange={(e) => { setFormStyle(e.target.value); setFormError(""); setSaveConfirmation(""); }}
          placeholder="Describe the artist's style (e.g., Synthwave, nostalgic, cinematic...)"
          rows={4}
        ></textarea>
        
        {formError && <p className="form-error" role="alert">{formError}</p>}
        {saveConfirmation && <p className="save-success-message" role="status">{saveConfirmation}</p>}
        
        <div className="form-actions">
          <button className="btn btn-primary" onClick={handleSave}>
            {editingArtist ? "Save Changes" : "Add Artist"}
          </button>
          {editingArtist && (
            <button className="btn btn-secondary" onClick={() => setEditingArtist(null)}>
              Cancel
            </button>
          )}
        </div>

        {!editingArtist && (
            <>
                <div className="form-divider"><span>OR</span></div>
                <div className="ai-generation-section">
                    <textarea
                        value={aiComment}
                        onChange={(e) => setAiComment(e.target.value)}
                        placeholder="Optionally, guide the AI (e.g., 'a duo mixing celtic music and cyberpunk')"
                        rows={2}
                    ></textarea>
                    <button
                        className="btn btn-secondary btn-lucky"
                        onClick={handleGenerateRandomArtist}
                        disabled={isGenerating}
                        title="Generate a random artist"
                    >
                        {isGenerating ? 'Generating...' : '✨ I trust my luck'}
                    </button>
                </div>
            </>
        )}
      </div>

      <div className="artist-list">
        <div className="artist-list-header">
            <h3>Your Artists</h3>
        </div>
        {artists.length === 0 ? (
          <p>No artists created yet. Add one above to get started!</p>
        ) : (
          <ul>
            {artists.map((artist) => (
              <li key={artist.id}>
                <div className="artist-info">
                  <strong>{artist.name}</strong>
                  <p>{artist.style}</p>
                </div>
                <div className="artist-actions">
                  <button className="btn btn-secondary" onClick={() => setEditingArtist(artist)}>Edit</button>
                  <button className="btn btn-danger" onClick={() => handleDelete(artist.id)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

// --- Create Song View ---
const CreateSongView = ({ artists, callGenerativeAI, generationHistory, updateGenerationHistory }: CreateSongViewProps) => {
  const [selectedArtistId, setSelectedArtistId] = useState("");
  const [comment, setComment] = useState("");
  const [isInstrumental, setIsInstrumental] = useState(false);
  const [language, setLanguage] = useState("English");
  const [creativity, setCreativity] = useState(25);
  const [songData, setSongData] = useState<SongData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState<'title' | 'style' | 'lyrics' | null>(null);
  
  const creativityLevels: { [key: number]: string } = {
    0: 'Identical', 25: 'Subtle', 50: 'Inspired',
    75: 'Experimental', 100: 'Wildcard',
  };

  useEffect(() => {
    if (artists.length > 0 && !artists.some(a => a.id.toString() === selectedArtistId)) {
        setSelectedArtistId(String(artists[0].id));
    } else if (artists.length === 0) {
        setSelectedArtistId("");
    }
  }, [artists, selectedArtistId]);
  
  const handleSuggestTheme = useCallback(async () => {
    const selectedArtist = artists.find(a => a.id.toString() === selectedArtistId);
    if (!selectedArtist) {
      setError("Please select an artist to get a theme suggestion.");
      return;
    }

    setIsSuggesting(true);
    setError(null);
    try {
        const artistHistory = generationHistory[selectedArtistId] || { titles: [], themes: [], lyrics: [] };
        let prompt = `You are a creative muse for songwriters. The artist is "${selectedArtist.name}" and their style is "${selectedArtist.style}". Generate a single, concise, and evocative song theme. The theme should be a very short phrase, ideally 2 to 5 words long.

CRITICAL:
- Do NOT start with "a song about" or "a track about".
- Provide only the theme itself, without any preamble, explanation, or quotation marks.

Examples of good themes:
- "Forgotten Astronaut"
- "Midnight Train to Nowhere"
- "City of Glass"
- "Echoes in the Rain"`;
        if (artistHistory.themes?.length > 0) {
            const cleanedThemes = artistHistory.themes.map(t => t.replace(/^(a song about|a track about)\s*/i, '').trim());
            prompt += `\n\nIMPORTANT: Avoid themes similar to these past suggestions for this artist: "${cleanedThemes.join('", "')}". Be original.`;
        }
        
        const payload: GenerateContentParameters = { model: 'gemini-2.5-flash', contents: prompt };
        const response = await callGenerativeAI(payload);
        const suggestedTheme = response.text.trim();
        setComment(suggestedTheme);
        
        const newHistory = { ...generationHistory };
        const artistId = selectedArtist.id.toString();
        if (!newHistory[artistId]) newHistory[artistId] = { titles: [], themes: [], lyrics: [] };
        newHistory[artistId].themes.push(suggestedTheme);
        updateGenerationHistory(newHistory);
    } catch (e) {
      console.error("Error suggesting theme:", e);
      setError(e.message || "Failed to suggest a theme. Please try again.");
    } finally {
      setIsSuggesting(false);
    }
  }, [selectedArtistId, artists, callGenerativeAI, generationHistory, updateGenerationHistory]);
  
  const handleGenerate = useCallback(async () => {
    const selectedArtist = artists.find(a => a.id.toString() === selectedArtistId);
    if (!selectedArtist) {
      setError("Please select an artist.");
      return;
    }

    setIsLoading(true);
    setSongData(null);
    setError(null);
    const getCreativityInstruction = (level: number) => {
        if (level === 0) return "Adhere as strictly as possible to the artist's established style provided. The output should be a textbook example of their sound.";
        if (level === 25) return "Stay close to the artist's core style, but introduce one or two subtle, fresh elements. It should feel familiar yet new.";
        if (level === 50) return "Use the artist's style as a strong starting point, but feel free to blend in a complementary genre or experiment with song structure. This is an evolution of their sound.";
        if (level === 75) return "Take significant creative liberties. The artist's core style should be recognizable as a faint echo, but the primary focus is on innovation and unexpected fusion of genres.";
        return "Completely deconstruct the artist's style. Generate a 'what if?' scenario. What if this artist made a song in a completely unrelated genre? Be bold, abstract, and unpredictable. The connection to the original artist should be artistic and conceptual, not literal.";
    };
    const creativityInstruction = getCreativityInstruction(creativity);
    const thematicConstraint = "\nIMPORTANT: The song's themes must avoid clichés related to technology, computers, virtual reality, the internet, and electricity. Focus on timeless, human themes like emotions, stories, nature, or abstract concepts.\n";
    
    const artistHistory = generationHistory[selectedArtistId] || { titles: [], themes: [], lyrics: [] };
    let historyConstraints = "";
    if (artistHistory.titles?.length > 0) historyConstraints += `\n\nCRITICAL: Be creative and original. Avoid generating a song concept similar to these past titles for this artist: "${artistHistory.titles.join('", "')}".`;
    if (artistHistory.lyrics?.length > 0) {
        const lyricSnippets = artistHistory.lyrics.map(lyric => {
             const cleaned = lyric.replace(/\[.*?\]|\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
             return cleaned.substring(0, 150);
        }).join('"; "');
        historyConstraints += `\nAlso avoid lyrical themes or concepts similar to these previous songs: "${lyricSnippets}".`;
    }
    let prompt;
    let responseSchema;
    if (isInstrumental) {
      prompt = `You are a songwriter for the artist "${selectedArtist.name}". Their signature style is: "${selectedArtist.style}".\nYour task is to generate a complete CONCEPT FOR AN INSTRUMENTAL-ONLY song that fits this artist.\n${creativityInstruction}${thematicConstraint}`;
      if (comment) prompt += `Use the following idea or theme for the instrumental's mood: "${comment}".\n`;
      else prompt += `The theme and mood must be completely new and original.\n`;
      prompt += historyConstraints;
      prompt += `The output must be a song concept with a title, a musical style description (MAXIMUM 250 characters), and a detailed structural description for Suno.\nCRITICAL RULE: The structural description in the 'lyrics' field MUST NOT contain any singable words or lyrics. It should only describe the musical sections, instruments, and arrangement.

NEW REQUIREMENT: The structural description should be comprehensive and long enough to describe a full song of approximately 3 to 4 minutes. Aim for at least 12-16 distinct structural lines/sections (e.g., [Intro], [Verse 1 Theme], [Verse 1 Development], [Pre-Chorus Build], [Chorus 1], etc.). Be very descriptive about the instrumentation, dynamics (loud/soft), and energy level throughout the song.

ABSOLUTELY CRITICAL FORMATTING RULES:
- Use section tags like [Intro], [Verse Theme], [Chorus Theme], [Bridge], [Outro], etc.
- YOU MUST add a single blank line between song sections. This is not optional.

EXAMPLE OF **CORRECT** FORMATTING:
[Intro]
[soft, atmospheric synth pads with a slow, delayed piano melody]

[Verse Theme]
[a gentle 4/4 drum beat enters. a simple, melodic bassline carries the harmony]

EXAMPLE OF **INCORRECT** FORMATTING (DO NOT DO THIS):
[Intro][soft, atmospheric synth pads...][Verse Theme][a gentle 4/4 drum beat...]

ALWAYS follow the CORRECT formatting example.

Be creative with the song structure. A simple [Intro]-[Verse]-[Chorus]-[Outro] is not always necessary. The structure should create a dynamic journey for the listener. Think about tension and release, building complexity, and creating a distinct mood for each section.

Here are some examples of possible structural approaches:
- A simple, evolving structure: [Intro] -> [Groove A] -> [Groove A with new layer] -> [Breakdown] -> [Groove B] -> [Outro]
- A narrative structure: [Exposition] -> [Rising Action] -> [Climax] -> [Falling Action] -> [Resolution]
- A classic song structure: [Intro] -> [Verse Theme] -> [Chorus Theme] -> [Verse Theme 2] -> [Chorus Theme] -> [Bridge] -> [Solo] -> [Outro]

Use descriptive cues to outline the instrumentation, dynamics, and feel of each section. For example: [delicate piano melody enters over a sparse beat] or [heavy distorted guitars take over with a powerful drum fill].`;
      responseSchema = { type: Type.OBJECT, properties: { title: { type: Type.STRING }, style: { type: Type.STRING }, lyrics: { type: Type.STRING } }, required: ["title", "style", "lyrics"] };
    } else {
      prompt = `You are a songwriter for the artist "${selectedArtist.name}". Their signature style is: "${selectedArtist.style}".\nYour task is to generate a complete song concept that fits this artist.\n${creativityInstruction}${thematicConstraint}`;
      if (comment) prompt += `Use the following idea or theme: "${comment}".\n`;
      else prompt += `The theme and lyrics must be completely new and original, telling a different story from any previous request for this artist.\n`;
      prompt += historyConstraints;
      prompt += `The output must be a song with a title, a musical style description (MAXIMUM 250 characters), and full lyrics.\nCRITICAL RULE: The lyrics MUST NOT mention the artist's name or the song's genre/style. The story and emotion should stand on their own.\nThe title and lyrics MUST be in ${language}.\n\nABSOLUTELY CRITICAL FORMATTING RULES:\n- Use section tags like [Verse 1], (Chorus), [Bridge], (Outro), etc.\n- YOU MUST add a single blank line between song sections. This is not optional.\n\nEXAMPLE OF **CORRECT** FORMATTING:\n[Verse 1]\nA single light flickers in the dark\nAnother night, another faded mark\n\n(Chorus)\nWe run through streets of silver and of rust\nTurning memories into dust\n\nEXAMPLE OF **INCORRECT** FORMATTING (DO NOT DO THIS):\n[Verse 1]A single light flickers in the dark\n(Chorus)We run through streets of silver and of rust\n\nALWAYS follow the CORRECT formatting example.\n\nBe creative with the song structure. You do not need to follow a traditional verse-chorus-verse structure. Feel free to use less common structures like AABA, or a more progressive structure that builds over time. The structure should serve the song's narrative and emotional arc.\n\nFor example, you could use structures like:\n- Intro -> Verse 1 -> Pre-Chorus -> Chorus -> Verse 2 -> Pre-Chorus -> Chorus -> Bridge -> Guitar Solo -> Chorus -> Outro\n- Intro -> Part A -> Part B (builds) -> Part C (climax) -> Outro\n- Verse 1 -> Verse 2 -> Bridge -> Verse 3\n\nEnsure the lyrics are well-written, evocative, and fit the artist's style.`;
      responseSchema = { type: Type.OBJECT, properties: { title: { type: Type.STRING }, style: { type: Type.STRING }, lyrics: { type: Type.STRING } }, required: ["title", "style", "lyrics"] };
    }
    try {
      const payload: GenerateContentParameters = {
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: { responseMimeType: "application/json", responseSchema: responseSchema },
      };
      const response = await callGenerativeAI(payload);
      const responseText = response.text.trim();
      const parsedData = JSON.parse(responseText);
      setSongData(parsedData);
      
      const newHistory = { ...generationHistory };
      const artistId = selectedArtist.id.toString();
      if (!newHistory[artistId]) newHistory[artistId] = { titles: [], themes: [], lyrics: [] };
      newHistory[artistId].titles.push(parsedData.title);
      newHistory[artistId].lyrics.push(parsedData.lyrics);
      updateGenerationHistory(newHistory);
    } catch (e) {
      console.error("Error generating song:", e);
      setError(e.message || "Failed to generate the song. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedArtistId, comment, artists, callGenerativeAI, isInstrumental, generationHistory, updateGenerationHistory, creativity, language]);
  
  const handleCopy = useCallback(async (content: string, buttonId: string) => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      const button = document.getElementById(buttonId);
      if (button) {
        button.textContent = 'Copied!';
        button.classList.add('copied');
        setTimeout(() => {
          button.textContent = 'Copy';
          button.classList.remove('copied');
        }, 2000);
      }
    } catch (err) {
      console.error('Failed to copy text: ', err);
      alert('Failed to copy text.');
    }
  }, []);

  const handleRegenerate = useCallback(async (field: 'title' | 'style' | 'lyrics') => {
    const selectedArtist = artists.find(a => a.id.toString() === selectedArtistId);
    if (!selectedArtist || !songData) {
        setError("Cannot regenerate: missing artist or song data.");
        return;
    }

    setIsRegenerating(field);
    setError(null);

    const getCreativityInstruction = (level: number) => {
        if (level === 0) return "Adhere as strictly as possible to the artist's established style provided. The output should be a textbook example of their sound.";
        if (level === 25) return "Stay close to the artist's core style, but introduce one or two subtle, fresh elements. It should feel familiar yet new.";
        if (level === 50) return "Use the artist's style as a strong starting point, but feel free to blend in a complementary genre or experiment with song structure. This is an evolution of their sound.";
        if (level === 75) return "Take significant creative liberties. The artist's core style should be recognizable as a faint echo, but the primary focus is on innovation and unexpected fusion of genres.";
        return "Completely deconstruct the artist's style. Generate a 'what if?' scenario. What if this artist made a song in a completely unrelated genre? Be bold, abstract, and unpredictable. The connection to the original artist should be artistic and conceptual, not literal.";
    };
    const creativityInstruction = getCreativityInstruction(creativity);
    const thematicConstraint = "\nIMPORTANT: The song's themes must avoid clichés related to technology, computers, virtual reality, the internet, and electricity. Focus on timeless, human themes like emotions, stories, nature, or abstract concepts.\n";

    let prompt = "";
    let responseSchema: any;
    const artistHistory = generationHistory[selectedArtistId] || { titles: [], themes: [], lyrics: [] };

    switch(field) {
        case 'title':
            prompt = `You are a creative naming expert for music. Your task is to generate a new, compelling title in ${language} for an existing song concept.\n\nArtist: "${selectedArtist.name}"\nStyle: "${songData.style}"\nLyrics Snippet: "${songData.lyrics.substring(0, 300)}..."\n\nThe previous title was: "${songData.title}". Please generate a completely different title that fits the provided style and lyrics.\n\nReturn the result as a JSON object with a single "title" key.`;
            if (artistHistory.titles?.length > 0) {
              prompt += `\nAvoid titles similar to these past titles for this artist: "${artistHistory.titles.join('", "')}".`;
            }
            responseSchema = { type: Type.OBJECT, properties: { title: { type: Type.STRING } }, required: ["title"] };
            break;
        case 'style':
            prompt = `You are a music journalist with a deep understanding of genres. Your task is to write a new, concise musical style description (MAXIMUM 250 characters) for an existing song concept.\n\nArtist: "${selectedArtist.name}"\nTitle: "${songData.title}"\nLyrics Snippet: "${songData.lyrics.substring(0, 300)}..."\n\nThe previous style description was: "${songData.style}". Please write a different but fitting description that still aligns with the artist's core identity: "${selectedArtist.style}".\n\nReturn the result as a JSON object with a single "style" key.`;
            responseSchema = { type: Type.OBJECT, properties: { style: { type: Type.STRING } }, required: ["style"] };
            break;
        case 'lyrics':
            const lyricSnippets = artistHistory.lyrics.map(lyric => {
                 const cleaned = lyric.replace(/\[.*?\]|\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
                 return cleaned.substring(0, 150);
            }).join('"; "');
            let historyConstraints = `\nAlso avoid lyrical themes or concepts similar to these previous songs: "${lyricSnippets}".`;

            if (isInstrumental) {
                prompt = `You are a songwriter for the artist "${selectedArtist.name}". Their signature style is: "${selectedArtist.style}".\nYour task is to REGENERATE a complete CONCEPT FOR AN INSTRUMENTAL-ONLY song titled "${songData.title}".\n${creativityInstruction}${thematicConstraint}\nUse the following idea or theme for the instrumental's mood: "${comment}".\n${historyConstraints}\nCRITICAL: The new structural description must be substantially different from the previous one, which started with: "${songData.lyrics.substring(0, 150)}...".\n\nThe output must be a new, detailed structural description. Do not include singable words.

NEW REQUIREMENT: The structural description should be comprehensive and long enough to describe a full song of approximately 3 to 4 minutes. Aim for at least 12-16 distinct structural lines/sections (e.g., [Intro], [Verse 1 Theme], [Verse 1 Development], [Pre-Chorus Build], [Chorus 1], etc.). Be very descriptive about the instrumentation, dynamics (loud/soft), and energy level throughout the song.

ABSOLUTELY CRITICAL FORMATTING RULES:
- Use section tags like [Intro], [Verse Theme], [Chorus Theme], etc.
- YOU MUST add a single blank line between song sections.

EXAMPLE OF CORRECT FORMATTING:
[Intro]
[soft synth pads]

[Verse Theme]
[a gentle drum beat enters]

ALWAYS follow this formatting. Return the result as a JSON object with a single "lyrics" key.`;
            } else {
                prompt = `You are a songwriter for the artist "${selectedArtist.name}". Their signature style is: "${selectedArtist.style}".\nYour task is to REWRITE the lyrics for a song concept titled "${songData.title}". Keep the original theme but provide a fresh lyrical take.\nUse the following idea or theme: "${comment}".\n${creativityInstruction}${thematicConstraint}${historyConstraints}\nCRITICAL: The new lyrics must be in ${language} and be substantially different from the previous version, which started with: "${songData.lyrics.substring(0, 150)}...".\n\nThe output must be a new set of full lyrics.\n\nABSOLUTELY CRITICAL FORMATTING RULES:\n- Use section tags like [Verse 1], (Chorus), etc.\n- YOU MUST add a single blank line between song sections.\n\nEXAMPLE OF CORRECT FORMATTING:\n[Verse 1]\nNew words for a lonely night\n\n(Chorus)\nA different tune in fading light\n\nALWAYS follow this formatting. Return the result as a JSON object with a single "lyrics" key.`;
            }
            responseSchema = { type: Type.OBJECT, properties: { lyrics: { type: Type.STRING } }, required: ["lyrics"] };
            break;
    }

    try {
        const payload: GenerateContentParameters = {
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { responseMimeType: "application/json", responseSchema: responseSchema },
        };
        const response = await callGenerativeAI(payload);
        const responseText = response.text.trim();
        const parsedData = JSON.parse(responseText);

        setSongData(prevData => {
            if (!prevData) return null;
            const updatedData = { ...prevData, ...parsedData };
            
            const newHistory = { ...generationHistory };
            const artistId = selectedArtist.id.toString();
            if (!newHistory[artistId]) newHistory[artistId] = { titles: [], themes: [], lyrics: [] };
            if (field === 'title' && parsedData.title) {
                newHistory[artistId].titles.push(parsedData.title);
            }
            if (field === 'lyrics' && parsedData.lyrics) {
                newHistory[artistId].lyrics.push(parsedData.lyrics);
            }
            updateGenerationHistory(newHistory);

            return updatedData;
        });

    } catch (e) {
        console.error(`Error regenerating ${field}:`, e);
        setError(e.message || `Failed to regenerate the ${field}. Please try again.`);
    } finally {
        setIsRegenerating(null);
    }
  }, [selectedArtistId, artists, songData, callGenerativeAI, generationHistory, updateGenerationHistory, creativity, comment, isInstrumental, language]);


  return (
    <>
      <div className="input-container">
        <select value={selectedArtistId} onChange={(e) => setSelectedArtistId(e.target.value)} disabled={artists.length === 0}>
           {artists.length === 0 ? (
            <option>Please create an artist first</option>
          ) : (
            artists.map(artist => <option key={artist.id} value={artist.id}>{artist.name}</option>)
          )}
        </select>
        <div className="comment-container">
          <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional theme (e.g., a lost city)" aria-label="Optional theme" />
           <button onClick={handleSuggestTheme} className="btn-suggest" title="Suggest a theme" disabled={isSuggesting || artists.length === 0 || !selectedArtistId}>
              {isSuggesting ? <div className="spinner-small"></div> : '💡'}
          </button>
        </div>
        <div className="options-container">
            <div className="language-selector">
                <label htmlFor="language">Language</label>
                <select 
                    id="language"
                    value={language} 
                    onChange={(e) => setLanguage(e.target.value)} 
                    disabled={isInstrumental}
                    aria-label="Select language for lyrics"
                >
                    <option value="English">English</option>
                    <option value="French">French</option>
                    <option value="Spanish">Spanish</option>
                    <option value="German">German</option>
                    <option value="Italian">Italian</option>
                    <option value="Portuguese">Portuguese</option>
                    <option value="Japanese">Japanese</option>
                    <option value="Korean">Korean</option>
                    <option value="Russian">Russian</option>
                </select>
            </div>
            <div className="instrumental-checkbox">
                <input type="checkbox" id="instrumental" checked={isInstrumental} onChange={(e) => setIsInstrumental(e.target.checked)} />
                <label htmlFor="instrumental">Instrumental</label>
            </div>
        </div>
        <div className="creativity-slider-container">
            <label htmlFor="creativity">Creativity Level: <span className="creativity-level-label">{creativityLevels[creativity]}</span></label>
            <input type="range" id="creativity" min="0" max="100" step="25" value={creativity} onChange={(e) => setCreativity(Number(e.target.value))} />
        </div>
        <button className="btn btn-generate" onClick={handleGenerate} disabled={isLoading || artists.length === 0}>
          {isLoading ? 'Generating...' : '✨ Generate Song'}
        </button>
      </div>
      {error && <div className="error-message" role="alert">{error}</div>}
      <div className="results-container">
        {isLoading && <div className="spinner-overlay"><div className="spinner"></div></div>}
        {!isLoading && !songData && (<div className="placeholder-results">Your generated song will appear here.</div>)}
        {songData && (
          <div className="song-output">
            <ResultCard 
                id="title" 
                title="🎤 Title" 
                content={songData.title} 
                onCopy={handleCopy}
                onRegenerate={() => handleRegenerate('title')}
                isRegenerating={isRegenerating === 'title'}
            />
            <ResultCard 
                id="style" 
                title="🎸 Style" 
                content={songData.style} 
                onCopy={handleCopy}
                onRegenerate={() => handleRegenerate('style')}
                isRegenerating={isRegenerating === 'style'}
            />
            <ResultCard 
                id="lyrics" 
                title="📜 Lyrics" 
                content={songData.lyrics} 
                onCopy={handleCopy} 
                isLarge={true}
                onRegenerate={() => handleRegenerate('lyrics')}
                isRegenerating={isRegenerating === 'lyrics'}
            />
          </div>
        )}
      </div>
    </>
  );
};

const AuthView = ({ auth, db }: AuthViewProps) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (isLogin) {
        let userEmail = email.trim();
        // If it doesn't look like an email, assume it's a username
        if (!userEmail.includes('@')) {
          // Query Firestore for the user with this displayName
          const usersRef = collection(db, "users");
          const q = query(usersRef, where("displayName", "==", userEmail));
          const querySnapshot = await getDocs(q);
          if (querySnapshot.empty) {
            throw new Error("Invalid username or password.");
          }
          // Get the email from the found user document
          const userData = querySnapshot.docs[0].data();
          userEmail = userData.email;
          if (!userEmail) {
            // This case should ideally not happen if data is consistent
            throw new Error("Login failed. Please try again.");
          }
        }
        await signInWithEmailAndPassword(auth, userEmail, password);
      } else {
        const trimmedEmail = email.trim();
        const trimmedUsername = username.trim();

        if (trimmedUsername.length < 3) {
          throw new Error("Username must be at least 3 characters long.");
        }

        // Check if username is already taken
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("displayName", "==", trimmedUsername));
        const usernameSnapshot = await getDocs(q);
        if (!usernameSnapshot.empty) {
          throw new Error("Username is already taken. Please choose another one.");
        }

        const userCredential = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
        await updateProfile(userCredential.user, {
          displayName: trimmedUsername
        });
        
        // Create user document in Firestore
        const userDocRef = doc(db, "users", userCredential.user.uid);
        // REVERT: Re-add apiKey to user document on creation.
        await setDoc(userDocRef, {
          artists: [],
          generationHistory: {},
          displayName: trimmedUsername,
          email: trimmedEmail.toLowerCase(),
          apiKey: "",
        });
      }
    } catch (err: any) {
      let message = err.message;
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        message = 'Invalid username or password.';
      } else if (err.code === 'auth/email-already-in-use') {
        message = 'An account with this email address already exists.';
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };
  
  const handleGoogleSignIn = async () => {
    setError("");
    setLoading(true);
    const provider = new GoogleAuthProvider();
    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        
        // Check if it's a new user and create their profile in Firestore.
        const userDocRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(userDocRef);
        if (!docSnap.exists() && user.displayName && user.email) {
            // REVERT: Re-add apiKey to user document on creation.
            await setDoc(userDocRef, {
                artists: [],
                generationHistory: {},
                displayName: user.displayName,
                email: user.email.toLowerCase(),
                apiKey: "",
            });
        }
        // On success, the onAuthStateChanged listener will handle the UI update,
        // so we don't need to setLoading(false) here.
    } catch (err: any) {
        console.error("Google Sign-In Error:", err);
        let message = "Failed to sign in with Google. Please try again.";
        if (err.code === 'auth/popup-closed-by-user') {
            message = "Sign-in process was cancelled.";
        } else if (err.code === 'auth/unauthorized-domain') {
            message = "This domain is not authorized for Google Sign-In. Please contact support.";
        }
        setError(message);
        setLoading(false);
    }
  };

  return (
    <div className="auth-view">
      <form onSubmit={handleSubmit} className="form-card">
        <h3>{isLogin ? "Welcome Back!" : "Create Your Account"}</h3>
        {!isLogin && (
          <input
            type="text" value={username} onChange={(e) => setUsername(e.target.value)}
            placeholder="Username" aria-label="Username" required
          />
        )}
        <input
          type={isLogin ? "text" : "email"}
          value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder={isLogin ? "Username or Email" : "Email Address"}
          aria-label={isLogin ? "Username or Email" : "Email Address"} required
        />
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Password" aria-label="Password" required
        />
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? 'Processing...' : (isLogin ? 'Login' : 'Sign Up')}
        </button>
        <div className="form-divider"><span>OR</span></div>
        <button type="button" className="btn btn-google" onClick={handleGoogleSignIn} disabled={loading}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 18 18">
            <path d="M16.51 8.1H8.98v3.2h4.57c-.2 1.2-1.6 3.2-4.57 3.2-2.7 0-4.9-2.2-4.9-4.9s2.2-4.9 4.9-4.9c1.5 0 2.5.6 3.1 1.2l2.4-2.4C14.1.6 11.8 0 8.98 0 4.02 0 0 4.02 0 8.98s4.02 8.98 8.98 8.98c4.96 0 8.52-3.46 8.52-8.52 0-.5-.05-1.05-.1-1.55Z" fill="#4285F4"></path>
            <path d="M16.51 8.1H8.98v3.2h4.57c-.2 1.2-1.6 3.2-4.57 3.2-2.7 0-4.9-2.2-4.9-4.9s2.2-4.9 4.9-4.9c1.5 0 2.5.6 3.1 1.2l2.4-2.4C14.1.6 11.8 0 8.98 0 4.02 0 0 4.02 0 8.98s4.02 8.98 8.98 8.98c4.96 0 8.52-3.46 8.52-8.52 0-.5-.05-1.05-.1-1.55Z" fill-opacity="0" fill="#000000"></path>
            <path d="M16.51 8.1H8.98v3.2h4.57c-.2 1.2-1.6 3.2-4.57 3.2-2.7 0-4.9-2.2-4.9-4.9s2.2-4.9 4.9-4.9c1.5 0 2.5.6 3.1 1.2l2.4-2.4C14.1.6 11.8 0 8.98 0 4.02 0 0 4.02 0 8.98s4.02 8.98 8.98 8.98c4.96 0 8.52-3.46 8.52-8.52 0-.5-.05-1.05-.1-1.55Z" fill-opacity="0" fill="#000000"></path>
            <path d="M3.86 10.97c-.2-.6-.3-1.2-.3-1.9s.1-1.3.3-1.9V5.8H1.4C.5 7.3 0 8.98 0 8.98s.5 1.68 1.4 3.18l2.46-1.99Z" fill="#FBBC05"></path>
            <path d="M8.98 17.96c2.4 0 4.5-.8 6-2.2l-2.4-2.4c-.8.5-1.8.8-3.1.8-2.7 0-4.9-1.9-5.7-4.4H1.4v2.5C2.8 15.4 5.6 17.96 8.98 17.96Z" fill="#34A853"></path>
            <path d="M4.5 13.37 1.4 15.9C2.8 17.4 5.6 18 8.98 18c2.4 0 4.5-.8 6-2.2l-2.4-2.4c-.8.5-1.8.8-3.1.8-2.7 0-4.9-1.9-5.7-4.4H1.4v2.5C2.8 15.4 5.6 17.96 8.98 17.96Z" fill-opacity="0" fill="#000000"></path>
            <path d="M8.98 3.88c1.8 0 3.3.8 4.3 1.8l2.1-2.1c-1.4-1.3-3.3-2.1-5.8-2.1-3.4 0-6.2 2.5-7.6 5.9L4.3 8.2c.8-2.5 3-4.4 5.7-4.4Z" fill="#EA4335"></path>
          </svg>
          Sign in with Google
        </button>
        <button type="button" className="switch-auth-mode" onClick={() => { setIsLogin(!isLogin); setError(""); setUsername(""); setEmail(""); }}>
          {isLogin ? "Need an account? Sign Up" : "Already have an account? Login"}
        </button>
      </form>
    </div>
  );
};

// REVERT: Re-add ProfileView component for managing the API key.
const ProfileView = ({ user, apiKey, updateApiKey }: ProfileViewProps) => {
    const [keyInput, setKeyInput] = useState("");
    const [isKeyVisible, setIsKeyVisible] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);

    useEffect(() => {
        setKeyInput(apiKey || "");
    }, [apiKey]);
    
    const handleSave = async () => {
        setIsSaving(true);
        setSaveSuccess(false);
        try {
            await updateApiKey(keyInput);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (e) {
            console.error("Failed to save API key", e);
            alert("There was an error saving your API key. Please try again.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="profile-view">
            <div className="form-card">
                <h3>Your Profile</h3>
                <div className="profile-info">
                    <p><strong>Username:</strong> {user.displayName}</p>
                    <p><strong>Email:</strong> {user.email}</p>
                </div>

                <div className="api-key-section">
                    <label htmlFor="api-key-input">Your Google AI API Key</label>
                    <div className="api-key-input-wrapper">
                      <input
                          id="api-key-input"
                          type={isKeyVisible ? "text" : "password"}
                          value={keyInput}
                          onChange={(e) => { setKeyInput(e.target.value); setSaveSuccess(false); }}
                          placeholder="Enter your API key here"
                          aria-label="Google AI API Key"
                      />
                      <button className="btn btn-secondary btn-show-hide" onClick={() => setIsKeyVisible(!isKeyVisible)}>
                          {isKeyVisible ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    <p className="help-text">
                        The AI features in this app require a Google AI API key.
                        Your key is stored securely in your user document in Firestore and is only used by you.
                        You can get a key from <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a>.
                    </p>
                </div>
                
                {saveSuccess && <p className="save-success-message">API Key saved successfully!</p>}
                
                <div className="form-actions">
                    <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>
                        {isSaving ? 'Saving...' : 'Save API Key'}
                    </button>
                </div>
            </div>
        </div>
    );
};


// --- Main App Component ---
const App = () => {
  // REVERT: Re-add 'profile' to view state.
  const [view, setView] = useState<'create' | 'manage' | 'profile'>('create');
  const [artists, setArtists] = useState<Artist[]>([]);
  const [generationHistory, setGenerationHistory] = useState<GenerationHistory>({});
  
  const [firebaseConfig, setFirebaseConfig] = useState(PRECONFIGURED_FIREBASE_CONFIG);
  
  const [auth, setAuth] = useState<Auth | null>(null);
  const [db, setDb] = useState<Firestore | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [appReady, setAppReady] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  // REVERT: Re-add apiKey state for user-managed keys.
  const [apiKey, setApiKey] = useState<string | null>(null);
  
  // REVERT: Initialize GoogleGenAI based on the user's API key from state.
  const genAI = useMemo(() => {
    if (apiKey) {
        try {
            return new GoogleGenAI({ apiKey });
        } catch (e) {
            console.error("Failed to initialize GoogleGenAI:", e);
            alert("The provided API key is malformed. Please check it in your profile.");
            return null;
        }
    }
    return null;
  }, [apiKey]);


  // Initialize Firebase
  useEffect(() => {
    if (firebaseConfig) {
      try {
        const app = initializeApp(firebaseConfig);
        setAuth(getAuth(app));
        setDb(getFirestore(app));
      } catch (e) {
        console.error("Firebase initialization failed:", e);
        if (!appReady) setAppReady(true);
      }
    } else {
        if (!appReady) setAppReady(true);
    }
  }, [firebaseConfig, appReady]);
  
  // Handle auth state changes
  useEffect(() => {
    if (!auth) {
        if (!appReady) setAppReady(true);
        return;
    }
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!appReady) {
        setAppReady(true);
      }
    });
    return () => unsubscribe();
  }, [auth, appReady]);

  // Load user data from Firestore
  useEffect(() => {
    if (!user) {
      setDataLoading(false);
      // Clear data on logout
      setArtists([]);
      setGenerationHistory({});
      // REVERT: Clear apiKey on logout.
      setApiKey(null);
      return;
    }
    
    const loadUserData = async () => {
      if (!db) return;
      setDataLoading(true);
      const userDocRef = doc(db, "users", user.uid);
      try {
        const docSnap = await getDoc(userDocRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setArtists(data.artists || []);
          setGenerationHistory(data.generationHistory || {});
          // REVERT: Load API key from user's document.
          setApiKey(data.apiKey || null);
          
          if (!data.email && user.email) {
            await setDoc(userDocRef, { email: user.email.toLowerCase() }, { merge: true });
          }

        } else if (user.displayName && user.email) {
          // REVERT: Add apiKey on new user document creation.
          await setDoc(userDocRef, { artists: [], generationHistory: {}, displayName: user.displayName, email: user.email.toLowerCase(), apiKey: "" });
          setArtists([]);
          setGenerationHistory({});
          setApiKey(null);
        }
      } catch (e: any) {
        console.error("Error loading user data:", e);
        let alertMessage;
        if (e.code === 'unavailable' || e.message.includes('offline')) {
            alertMessage = "Connection to Firestore failed. The application may not work correctly.\n\nPlease check the following:\n1. Your internet connection is active.\n2. In your Firebase project ('suno-machine'), you have created a Cloud Firestore database.\n3. The Firebase project configuration is correct.";
        } else if (e.code === 'permission-denied') {
            alertMessage = "Access to Firestore was denied. This is a security rules issue.\n\nPlease go to your Firebase project's Firestore settings and ensure your Security Rules allow authenticated users to read and write their own data.\n\nExample rule for /users/{userId}:\n'allow read, write: if request.auth.uid == userId;'";
        } else {
            alertMessage = `An unexpected error occurred while loading your data: ${e.message}. Please try refreshing the page.`;
        }
        alert(alertMessage);
      } finally {
        setDataLoading(false);
      }
    };

    loadUserData();
  }, [user, db]);

  const callGenerativeAI = async (payload: GenerateContentParameters): Promise<GenerateContentResponse> => {
    // REVERT: Update error check to guide user to Profile page.
    if (!apiKey || !genAI) {
      throw new Error("Your Google AI API key is missing or invalid. Please add it in your Profile.");
    }
    try {
        const response = await genAI.models.generateContent(payload);
        return response;
    } catch (error: any) {
        console.error("Google GenAI Error:", error);
        if (error.message && (error.message.includes('API key not valid') || error.message.includes('invalid'))) {
            throw new Error("Your Google AI API key is invalid. Please check it in your Profile.");
        }
        throw new Error("An error occurred while communicating with the AI service.");
    }
  };

  const handleLogout = async () => {
    if (auth) {
      await signOut(auth);
    }
  };

  // Generic function to update user data in Firestore
  const updateUserData = async (data: object) => {
    if (user && db) {
      const userDocRef = doc(db, "users", user.uid);
      try {
        const cleanData = JSON.parse(JSON.stringify(data));
        await setDoc(userDocRef, cleanData, { merge: true });
      } catch (error: any) {
        console.error("Firestore update failed:", error);
        let alertMessage = "There was a problem saving your data. Please check your connection and try again.";
        if (error.code === 'unavailable' || error.message.includes('offline')) {
          alertMessage = "Cannot save data: Connection to the database has been lost. Please check your internet connection and refresh the page.";
        } else if (error.code === 'permission-denied') {
          alertMessage = "Could not save data: Permission denied. This is likely a Firestore Security Rules issue. Please ensure they allow write access for authenticated users.";
        }
        alert(alertMessage);
      }
    }
  };

  const updateArtists = (newArtists: Artist[]) => {
    setArtists(newArtists);
    updateUserData({ artists: newArtists });
  };

  const updateGenerationHistory = (newHistory: GenerationHistory) => {
    setGenerationHistory(newHistory);
    updateUserData({ generationHistory: newHistory });
  };
  
  // REVERT: Re-add updateApiKey function.
  const updateApiKey = async (key: string) => {
    setApiKey(key);
    await updateUserData({ apiKey: key });
  };

  const renderContent = () => {
    // Priority 1: Wait for Firebase and Auth state to be ready.
    if (!appReady) {
      return <div className="spinner-overlay"><div className="spinner"></div></div>;
    }

    // Priority 2: If not authenticated, show the AuthView.
    if (!user) {
      if (!auth || !db) {
        return <p className="error-message">Error: Application services could not be loaded.</p>;
      }
      return <AuthView auth={auth} db={db} />;
    }

    // Priority 3: If authenticated, wait for user data to be ready.
    if (dataLoading) {
        return <div className="spinner-overlay"><div className="spinner"></div></div>;
    }

    // All clear: Render the main application.
    const renderCurrentView = () => {
        switch (view) {
            case 'create':
                return <CreateSongView artists={artists} callGenerativeAI={callGenerativeAI} generationHistory={generationHistory} updateGenerationHistory={updateGenerationHistory} />;
            case 'manage':
                return <ManageArtistsView artists={artists} updateArtists={updateArtists} callGenerativeAI={callGenerativeAI} generationHistory={generationHistory} updateGenerationHistory={updateGenerationHistory} />;
            // REVERT: Re-add 'profile' case.
            case 'profile':
                return <ProfileView user={user} apiKey={apiKey} updateApiKey={updateApiKey} />;
            default:
                setView('create'); // Fallback to a default view
                return null;
        }
    };

    return (
      <>
        <nav className="view-switcher">
          <button className={`btn ${view === 'create' ? 'active' : ''}`} onClick={() => setView('create')}>Create Song</button>
          <button className={`btn ${view === 'manage' ? 'active' : ''}`} onClick={() => setView('manage')}>Manage Artists</button>
          {/* REVERT: Re-add Profile button. */}
          <button className={`btn ${view === 'profile' ? 'active' : ''}`} onClick={() => setView('profile')}>Profile</button>
        </nav>
        {renderCurrentView()}
      </>
    );
  };

  return (
    <main>
      <header>
        <div className="header-content">
          <div className="logo">
            <svg width="48" height="48" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="50" cy="50" r="48" stroke="currentColor" strokeWidth="4"/>
              <path d="M20 50 Q 30 25, 40 50 T 60 50 T 80 50" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
            </svg>
            <h1>Suno Machine</h1>
          </div>
          <p>Your AI-powered song creation studio</p>
        </div>
        {user && (
            <div className="header-actions">
                <span className="user-display" title={user.email || ""}>{user.displayName || user.email}</span>
                <button onClick={handleLogout} className="btn btn-logout">Logout</button>
            </div>
        )}
      </header>
      {renderContent()}
    </main>
  );
};

const ResultCard = ({ id, title, content, onCopy, isLarge = false, onRegenerate, isRegenerating }: ResultCardProps) => (
    <div id={id} className={`result-card ${isLarge ? 'large' : ''}`}>
        {isRegenerating && (
            <div className="spinner-overlay-small">
                <div className="spinner"></div>
            </div>
        )}
        <div className="result-header">
            <h2>{title}</h2>
            <div className="result-header-actions">
                {onRegenerate && (
                    <button
                        id={`regenerate-${id}`}
                        className="btn btn-icon btn-regenerate-part"
                        onClick={() => onRegenerate(id)}
                        disabled={!content || isRegenerating}
                        title={`Regenerate ${title}`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                          <path fillRule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/>
                          <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/>
                        </svg>
                    </button>
                )}
                <button id={`copy-${id}`} className="btn btn-copy" onClick={() => onCopy(content, `copy-${id}`)} disabled={!content}>
                    Copy
                </button>
            </div>
        </div>
        <div className="result-content" aria-live="polite">
            {content}
        </div>
    </div>
);


const root = createRoot(document.getElementById("root")!);
root.render(<App />);