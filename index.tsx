/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Type } from "@google/genai";
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
  ai: GoogleGenAI | null;
  aiError: string | null;
  generationHistory: GenerationHistory;
  updateGenerationHistory: (newHistory: GenerationHistory) => void;
}

interface CreateSongViewProps {
  artists: Artist[];
  ai: GoogleGenAI | null;
  aiError: string | null;
  generationHistory: GenerationHistory;
  updateGenerationHistory: (newHistory: GenerationHistory) => void;
}

interface AuthViewProps {
  auth: Auth;
  db: Firestore;
}

interface ProfileViewProps {
    user: User;
    apiKey: string;
    updateApiKey: (newKey: string) => void;
}

interface ResultCardProps {
    id: string;
    title: string;
    content: string;
    onCopy: (content: string, buttonId: string) => void;
    isLarge?: boolean;
}

interface SongData {
    title: string;
    style: string;
    lyrics: string;
}

// --- Artist Management View ---
const ManageArtistsView = ({ artists, updateArtists, ai, aiError, generationHistory, updateGenerationHistory }: ManageArtistsViewProps) => {
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
    if (!ai) {
        setFormError(aiError || "AI Service is not configured. Please check your API key.");
        return;
    }
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

      const response = await ai.models.generateContent({
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
      });

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
      alert("Sorry, couldn't generate an artist. Please try again.");
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
                        disabled={!ai || isGenerating}
                        title={!ai ? (aiError || "AI Service not available") : "Generate a random artist"}
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
const CreateSongView = ({ artists, ai, aiError, generationHistory, updateGenerationHistory }: CreateSongViewProps) => {
  const [selectedArtistId, setSelectedArtistId] = useState("");
  const [comment, setComment] = useState("");
  const [isInstrumental, setIsInstrumental] = useState(false);
  const [creativity, setCreativity] = useState(25);
  const [songData, setSongData] = useState<SongData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
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
    if (!ai) {
        setError(aiError || "AI Service is not configured. Please check your API key.");
        return;
    }

    setIsSuggesting(true);
    setError(null);
    try {
        const artistHistory = generationHistory[selectedArtistId] || { titles: [], themes: [], lyrics: [] };
        let prompt = `You are a creative muse for songwriters. The artist is "${selectedArtist.name}" and their style is "${selectedArtist.style}". Generate a single, concise, and evocative song theme or concept. The theme should be a short phrase, perfect for inspiring a song. CRITICAL: The final output must start with either "a song about" or "a track about". Do not add any other preamble, explanation, or quotation marks. For example: "a song about a forgotten astronaut watching Earth from afar".`;
        if (artistHistory.themes?.length > 0) {
            prompt += `\n\nIMPORTANT: Avoid themes similar to these past suggestions for this artist: "${artistHistory.themes.join('", "')}". Be original.`;
        }
        const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
        const suggestedTheme = response.text.trim();
        setComment(suggestedTheme);
        
        const newHistory = { ...generationHistory };
        const artistId = selectedArtist.id.toString();
        if (!newHistory[artistId]) newHistory[artistId] = { titles: [], themes: [], lyrics: [] };
        newHistory[artistId].themes.push(suggestedTheme);
        updateGenerationHistory(newHistory);
    } catch (e) {
      console.error("Error suggesting theme:", e);
      setError("Failed to suggest a theme. Please try again.");
    } finally {
      setIsSuggesting(false);
    }
  }, [selectedArtistId, artists, ai, aiError, generationHistory, updateGenerationHistory]);
  
  const handleGenerate = useCallback(async () => {
    const selectedArtist = artists.find(a => a.id.toString() === selectedArtistId);
    if (!selectedArtist) {
      setError("Please select an artist.");
      return;
    }
    if (!ai) {
        setError(aiError || "AI Service is not configured. Please check your API key.");
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
      prompt += `The output must be a song concept with a title, a musical style description (MAXIMUM 250 characters), and a detailed structural description for Suno.\nCRITICAL RULE: The structural description in the 'lyrics' field MUST NOT contain any singable words or lyrics. It should only describe the musical sections, instruments, and arrangement.\nIMPORTANT: Format the structural description in a structure readable by Suno for instrumental tracks. This means including tags for song sections like [Intro], [Verse], [Chorus], [Bridge], [Outro], etc. and descriptive musical and instrumental cues in square brackets, for example: [soft piano intro with atmospheric pads] or [energetic synth lead over a driving bassline].\nCRITICAL FORMATTING RULE: ALWAYS add a blank line between song sections (e.g., between the end of the [Intro] section and the start of the [Verse] section). This is mandatory for readability.\n\nHere is a perfect example of the required format for the structural description (to be placed in the 'lyrics' field):\n[Intro]\n[8 bars of atmospheric synth pads building up]\n[A simple, melancholic piano melody enters]\n\n[Verse]\n[The beat kicks in with a steady lo-fi drum machine]\n[A warm, deep bassline carries the harmony]\n[The piano melody continues, slightly more complex]\n\n[Chorus]\n[The energy lifts with layered synths and a soaring lead melody]\n[The drums become more powerful with a driving kick and snare]\n[A subtle string section adds emotional depth]\n\n[Outro]\n[The main elements fade out one by one, starting with the drums]\n[The song ends with the initial piano melody and a final, lingering synth pad chord]\n`;
      responseSchema = { type: Type.OBJECT, properties: { title: { type: Type.STRING }, style: { type: Type.STRING }, lyrics: { type: Type.STRING } }, required: ["title", "style", "lyrics"] };
    } else {
      prompt = `You are a songwriter for the artist "${selectedArtist.name}". Their signature style is: "${selectedArtist.style}".\nYour task is to generate a complete song concept that fits this artist.\n${creativityInstruction}${thematicConstraint}`;
      if (comment) prompt += `Use the following idea or theme: "${comment}".\n`;
      else prompt += `The theme and lyrics must be completely new and original, telling a different story from any previous request for this artist.\n`;
      prompt += historyConstraints;
      prompt += `The output must be a song with a title, a musical style description (MAXIMUM 250 characters), and full lyrics.\nCRITICAL RULE: The lyrics MUST NOT mention the artist's name or the song's genre/style. The story and emotion should stand on their own.\nThe lyrics must be in English unless another language is explicitly requested in the comment.\n\nIMPORTANT: Format the lyrics in a structure readable by Suno. This means including tags for song sections like (Intro), [Verse 1], (Chorus), (Pre-Chorus), [Bridge], (Outro), etc. Also, include descriptive musical and instrumental cues in square brackets, for example: [soft piano intro] or [upbeat synth solo with heavy drums].\nCRITICAL FORMATTING RULE: ALWAYS add a blank line between song sections (e.g., between the end of the (Chorus) section and the start of the [Verse 2] section). This is mandatory for readability.\n\nHere is a perfect example of the required lyrics format:\n(Intro)\n\n[2 bars – filtered funk guitar + handclaps; subby kick building; short brass stab cue. One-shot “Uh!” ad-lib.]\n\n(Verse 1)\nI walk in slow, gold hoops, midnight glitter\nBeat says “go,” my pulse moves quicker\nI don’t chase love, I choose the rhythm\nSnap of the snare and I’m locked in the prism\nSide-eye sparkle, sugar on the lips\nBassline talking, hands on the hips\nIf you want the fire, say my name right now\nI turn the room to a holy vow\n\n(Pre-Chorus)\nHands up (hey), bass low (hey)\nLights down—here we go\nCan’t fake what we came here for\nOne spark, then we’re wanting more\n\n(Chorus)\nI put the fever on the floor\nTurn you up and give you more\nHoney-drip through every chord\nSay my name and watch me roar\nI put the fever on the floor\nFrom the ceiling to the door\nYou can’t fight it, don’t ignore—\nI’m the heat you’re looking for\n\n(Post-Chorus / Hook)\nHeatwave—oh! (heatwave)\nMake your heartbeat misbehave\nHeatwave—yeah! (heatwave)\nLet the heavy beat pave the way\n\n(Verse 2)\nVelvet thunder, 808s collide\nRhythm like a taxi, “Baby, get inside”\nI’m champagne sparkle with a razor edge\nSweet like the chorus, wild like the bridge\nLittle bit of trouble in a cherry gloss\nTurn a quiet Tuesday to a total boss\nIf you feel the fever, better lean in close—\nI’m a one-girl party and the world’s my host\n\n(Optional Rap – same singer)\nTap in—heels click, metronome killer,\nIndependent credit, I’m the headline filler,\nTwo-step slick with a capital S,\nPay me in respect and a wireless check,\nNo cap—clap track, double-time hi-hat,\nBass got a face like “who did that?”\nGlow so loud it invades your shade—\nI sell out silence with the noise I made.\n\n(Pre-Chorus)\nHands up (hey), bass low (hey)\nLights down—here we go\nCan’t fake what we came here for\nOne spark, then we’re wanting more\n\n(Chorus)\nI put the fever on the floor\nTurn you up and give you more\nHoney-drip through every chord\nSay my name and watch me roar\nI put the fever on the floor\nFrom the ceiling to the door\nYou can’t fight it, don’t ignore—\nI’m the heat you’re looking for\n\n[Drop to kick + claps + talkbox/vocoder answering the lead. Call-and-response.]\nYou say — (name) / I light your— (flame)\nWe bend that— (time) / We play no— (games)\nSlow it— (down) / bring it— (back)\nWhen it hits— (hits) / Now to\n\n[Drop to kick + claps + talkbox/vocoder answering the lead. Call-and-response.]\nYou say my— (name) / I light your— (flame)\nWe bend that— (time) / We play no— (games)\nSlow it— (down) / bring it— (back)\nWhen it hits— (hits) /Now to\n\nI put the fever on the floor\nFrom the ceiling to the door\nYou can’t fight it, don’t ignore—\nI’m the heat you’re looking for\n\n(Post-Chorus / Hook)\nHeatwave—oh! (heatwave)\nI put the fever on the floor\nTurn you up and give you more\nHoney-drip through every chord\nSay my name and watch me roar\nI put the fever on the floor\nFrom the ceiling to the door\nYou can’t fight it, don’t ignore—\nI’m the heat you’re looking for\n\n(Post-Chorus / Hook)\nHeatwave—oh! (heatwave)\n`;
      responseSchema = { type: Type.OBJECT, properties: { title: { type: Type.STRING }, style: { type: Type.STRING }, lyrics: { type: Type.STRING } }, required: ["title", "style", "lyrics"] };
    }
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: { responseMimeType: "application/json", responseSchema: responseSchema },
      });
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
      setError("Failed to generate the song. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedArtistId, comment, artists, ai, aiError, isInstrumental, generationHistory, updateGenerationHistory, creativity]);
  
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
          <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional comment (e.g., a song about a lost city)" aria-label="Optional comment" />
           <button onClick={handleSuggestTheme} className="btn-suggest" title={!ai ? (aiError || "AI Service not available") : "Suggest a theme"} disabled={!ai || isSuggesting || artists.length === 0 || !selectedArtistId}>
              {isSuggesting ? <div className="spinner-small"></div> : '💡'}
          </button>
        </div>
        <div className="instrumental-checkbox">
            <input type="checkbox" id="instrumental" checked={isInstrumental} onChange={(e) => setIsInstrumental(e.target.checked)} />
            <label htmlFor="instrumental">Instrumental</label>
        </div>
        <div className="creativity-slider-container">
            <label htmlFor="creativity">Creativity Level: <span className="creativity-level-label">{creativityLevels[creativity]}</span></label>
            <input type="range" id="creativity" min="0" max="100" step="25" value={creativity} onChange={(e) => setCreativity(Number(e.target.value))} />
        </div>
        <button className="btn btn-generate" onClick={handleGenerate} disabled={!ai || isLoading || artists.length === 0} title={!ai ? (aiError || "AI Service not available") : undefined}>
          {isLoading ? 'Generating...' : '✨ Generate Song'}
        </button>
      </div>
      {error && <div className="error-message" role="alert">{error}</div>}
      <div className="results-container">
        {isLoading && <div className="spinner-overlay"><div className="spinner"></div></div>}
        {!isLoading && !songData && (<div className="placeholder-results">Your generated song will appear here.</div>)}
        {songData && (
          <div className="song-output">
            <ResultCard id="title" title="🎤 Title" content={songData.title} onCopy={handleCopy} />
            <ResultCard id="style" title="🎸 Style" content={songData.style} onCopy={handleCopy} />
            <ResultCard id="lyrics" title="📜 Lyrics" content={songData.lyrics} onCopy={handleCopy} isLarge={true} />
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
        await setDoc(userDocRef, {
          artists: [],
          generationHistory: {},
          displayName: trimmedUsername,
          email: trimmedEmail.toLowerCase(),
          apiKey: ""
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
            await setDoc(userDocRef, {
                artists: [],
                generationHistory: {},
                displayName: user.displayName,
                email: user.email.toLowerCase(),
                apiKey: ""
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

const ProfileView = ({ user, apiKey, updateApiKey }: ProfileViewProps) => {
    const [formApiKey, setFormApiKey] = useState(apiKey);
    const [showKey, setShowKey] = useState(false);
    const [saveMessage, setSaveMessage] = useState("");

    useEffect(() => {
        setFormApiKey(apiKey);
    }, [apiKey]);

    const handleSave = () => {
        updateApiKey(formApiKey.trim());
        setSaveMessage("API Key saved successfully!");
        setTimeout(() => setSaveMessage(""), 3000);
    };

    return (
        <div className="profile-view">
            <div className="form-card">
                <h3>Profile & Settings</h3>
                <div className="profile-info">
                    <div><strong>Username:</strong> {user.displayName}</div>
                    <div><strong>Email:</strong> {user.email}</div>
                </div>
                <div className="form-divider"></div>
                <div className="api-key-section">
                    <label htmlFor="api-key">Your Google AI API Key</label>
                    <div className="api-key-input-wrapper">
                        <input
                            id="api-key"
                            type={showKey ? "text" : "password"}
                            value={formApiKey}
                            onChange={(e) => setFormApiKey(e.target.value)}
                            placeholder="Enter your Google AI API key"
                            aria-label="Google AI API Key"
                        />
                        <button className="btn btn-secondary btn-show-hide" onClick={() => setShowKey(!showKey)} aria-label={showKey ? 'Hide API key' : 'Show API key'}>
                            {showKey ? 'Hide' : 'Show'}
                        </button>
                    </div>
                    <p className="help-text">
                        You can get your API key from <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a>.
                        Your key is stored in your user profile and is only used from your browser.
                    </p>
                </div>
                <div className="form-actions">
                    <button className="btn btn-primary" onClick={handleSave} disabled={formApiKey.trim() === apiKey}>
                        Save API Key
                    </button>
                </div>
                {saveMessage && <p className="save-success-message" role="status">{saveMessage}</p>}
            </div>
        </div>
    );
};


// --- Main App Component ---
const App = () => {
  const [view, setView] = useState<'create' | 'manage' | 'profile'>('create');
  const [artists, setArtists] = useState<Artist[]>([]);
  const [generationHistory, setGenerationHistory] = useState<GenerationHistory>({});
  
  const [firebaseConfig, setFirebaseConfig] = useState(PRECONFIGURED_FIREBASE_CONFIG);
  
  const [auth, setAuth] = useState<Auth | null>(null);
  const [db, setDb] = useState<Firestore | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [appReady, setAppReady] = useState(false); // Unified loading state for auth
  const [dataLoading, setDataLoading] = useState(true);

  // AI State - now driven by user-provided key
  const [apiKey, setApiKey] = useState<string>("");
  const [ai, setAi] = useState<GoogleGenAI | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Initialize AI client when API key is available or changes
  useEffect(() => {
    if (apiKey) {
      try {
        setAi(new GoogleGenAI({ apiKey }));
        setAiError(null);
      } catch (e) {
        console.error("Failed to initialize GoogleGenAI:", e);
        setAi(null);
        setAiError("Could not initialize the AI client with the provided key. It might be invalid.");
      }
    } else {
      setAi(null);
      setAiError("API Key is not set. Please add it in your Profile.");
    }
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
        // If Firebase fails, the app is still technically "ready" to show an error.
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
      setApiKey("");
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
          setApiKey(data.apiKey || "");
          
          if (!data.email && user.email) {
            await setDoc(userDocRef, { email: user.email.toLowerCase() }, { merge: true });
          }

        } else if (user.displayName && user.email) {
          await setDoc(userDocRef, { artists: [], generationHistory: {}, displayName: user.displayName, email: user.email.toLowerCase(), apiKey: "" });
          setArtists([]);
          setGenerationHistory({});
          setApiKey("");
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
  
  const updateApiKey = (newApiKey: string) => {
    setApiKey(newApiKey);
    updateUserData({ apiKey: newApiKey });
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
                return <CreateSongView artists={artists} ai={ai} aiError={aiError} generationHistory={generationHistory} updateGenerationHistory={updateGenerationHistory} />;
            case 'manage':
                return <ManageArtistsView artists={artists} updateArtists={updateArtists} ai={ai} aiError={aiError} generationHistory={generationHistory} updateGenerationHistory={updateGenerationHistory} />;
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

const ResultCard = ({ id, title, content, onCopy, isLarge = false }: ResultCardProps) => (
    <div id={id} className={`result-card ${isLarge ? 'large' : ''}`}>
        <div className="result-header">
            <h2>{title}</h2>
            <button id={`copy-${id}`} className="btn btn-copy" onClick={() => onCopy(content, `copy-${id}`)} disabled={!content}>
                Copy
            </button>
        </div>
        <div className="result-content" aria-live="polite">
            {content}
        </div>
    </div>
);

const root = createRoot(document.getElementById("root")!);
root.render(<App />);