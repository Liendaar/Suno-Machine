/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Type } from "@google/genai";

// --- Artist Management View ---
const ManageArtistsView = ({ artists, setArtists, ai, generationHistory, setGenerationHistory }) => {
  const [editingArtist, setEditingArtist] = useState(null);
  const [formName, setFormName] = useState("");
  const [formStyle, setFormStyle] = useState("");
  const [formError, setFormError] = useState("");
  const [aiComment, setAiComment] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const fileInputRef = useRef(null);
  const historyFileInputRef = useRef(null);

  useEffect(() => {
    if (editingArtist) {
      setFormName(editingArtist.name);
      setFormStyle(editingArtist.style);
      setFormError("");
      setAiComment("");
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
      return;
    }

    if (editingArtist) {
      setArtists(
        artists.map((a) =>
          a.id === editingArtist.id ? { ...a, name: trimmedName, style: trimmedStyle } : a
        )
      );
    } else {
      setArtists([
        ...artists,
        { id: Date.now(), name: trimmedName, style: trimmedStyle },
      ]);
    }
    setEditingArtist(null);
  };

  const handleDelete = (id) => {
    if (window.confirm("Are you sure you want to delete this artist? This will also delete their generation history.")) {
      setArtists(prev => prev.filter((a) => a.id !== id));
      setGenerationHistory(prev => {
        const newHistory = { ...prev };
        delete newHistory[id];
        return newHistory;
      });
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
  
  const handleExport = () => {
    if (artists.length === 0) {
      return; // Button is disabled, but as a safeguard.
    }
    const jsonString = JSON.stringify(artists, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'suno_artists_backup.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  const handleImportClick = () => {
    fileInputRef.current?.click();
  };
  
  const handleFileSelect = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      // Always reset file input value to allow re-uploading the same file
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      if (!window.confirm('This will update existing artists and add new ones from the file. Do you want to continue?')) {
        return;
      }

      try {
        const text = e.target.result;
        if (typeof text !== 'string') {
          throw new Error("File could not be read as text.");
        }
        const importedArtists = JSON.parse(text);

        if (!Array.isArray(importedArtists)) {
          throw new Error("Invalid file format: must be a JSON array.");
        }

        // After the Array.isArray check, we can safely iterate. We explicitly type `artist` as `any`
        // in the callbacks to access its properties without TypeScript errors.
        const validArtists = importedArtists
          .filter((artist) => artist && typeof artist.name === 'string' && artist.name.trim() !== '' && typeof artist.style === 'string')
          .map((artist) => ({ ...artist, name: artist.name.trim() }));

        if (validArtists.length === 0) {
            alert("No valid artist data found in the file.");
            return;
        }

        setArtists(prevArtists => {
            const artistMap = new Map(prevArtists.map(a => [a.name.toLowerCase(), a]));
            let localAddedCount = 0;
            let localUpdatedCount = 0;
            
            validArtists.forEach((importedArtist) => {
                const key = importedArtist.name.toLowerCase();
                const existingArtist = artistMap.get(key);

                if (existingArtist) {
                    // FIX: Added type checks to safely handle potentially 'unknown' typed objects.
                    // This resolves errors with property access and spread syntax.
                    if (typeof existingArtist === 'object' && existingArtist !== null && 'style' in existingArtist) {
                        if (existingArtist.style !== importedArtist.style) {
                            artistMap.set(key, { ...existingArtist, style: importedArtist.style });
                            localUpdatedCount++;
                        }
                    }
                } else {
                    artistMap.set(key, {
                        name: importedArtist.name,
                        style: importedArtist.style,
                        id: Date.now() + Math.random()
                    });
                    localAddedCount++;
                }
            });

            // Schedule the alert to run after the state update is committed.
            setTimeout(() => {
                alert(`Import complete. ${localAddedCount} new artists added. ${localUpdatedCount} artists updated.`);
            }, 0);
            
            return Array.from(artistMap.values());
        });

      } catch (error) {
          console.error("Import failed:", error);
          alert(`Error importing file: ${error.message}`);
      }
    };
    reader.readAsText(file);
  };

  const handleExportHistory = () => {
    if (Object.keys(generationHistory).length === 0) return;
    const jsonString = JSON.stringify(generationHistory, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'suno_history_backup.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportHistoryClick = () => {
    historyFileInputRef.current?.click();
  };

  const handleHistoryFileSelect = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      if (historyFileInputRef.current) {
        historyFileInputRef.current.value = "";
      }

      if (!window.confirm('This will merge the imported history with your current history. Existing artist histories in the file will be overwritten. Continue?')) {
        return;
      }

      try {
        const text = e.target.result;
        if (typeof text !== 'string') throw new Error("File could not be read as text.");

        const importedHistory = JSON.parse(text);

        if (typeof importedHistory !== 'object' || importedHistory === null || Array.isArray(importedHistory)) {
          throw new Error("Invalid file format: must be a JSON object.");
        }

        setGenerationHistory(prev => ({...prev, ...importedHistory}));

        setTimeout(() => {
          alert(`History import complete. Data for ${Object.keys(importedHistory).length} artists was imported.`);
        }, 0);

      } catch (error) {
        console.error("History import failed:", error);
        alert(`Error importing history file: ${error.message}`);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="manage-artists-view">
      <div className="form-card">
        <h3>{editingArtist ? "Edit Artist" : "Add New Artist"}</h3>
        
        <input
          type="text"
          value={formName}
          onChange={(e) => {
            setFormName(e.target.value);
            setFormError("");
          }}
          placeholder="Artist Name (e.g., The Midnight)"
        />
        <textarea
          value={formStyle}
          onChange={(e) => setFormStyle(e.target.value)}
          placeholder="Describe the artist's style (e.g., Synthwave, nostalgic, cinematic...)"
          rows={4}
        ></textarea>
        
        {formError && <p className="form-error" role="alert">{formError}</p>}
        
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
            <div className="artist-list-actions">
                <button className="btn btn-secondary" onClick={handleImportClick}>
                    Import Artists
                </button>
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    style={{ display: "none" }}
                    accept=".json"
                />
                <button className="btn btn-secondary" onClick={handleExport} disabled={artists.length === 0}>
                    Export Artists
                </button>
                <button className="btn btn-secondary" onClick={handleImportHistoryClick}>
                    Import History
                </button>
                <input
                    type="file"
                    ref={historyFileInputRef}
                    onChange={handleHistoryFileSelect}
                    style={{ display: "none" }}
                    accept=".json"
                />
                <button className="btn btn-secondary" onClick={handleExportHistory} disabled={Object.keys(generationHistory).length === 0}>
                    Export History
                </button>
            </div>
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
const CreateSongView = ({ artists, ai, generationHistory, setGenerationHistory }) => {
  const [selectedArtistId, setSelectedArtistId] = useState("");
  const [comment, setComment] = useState("");
  const [isInstrumental, setIsInstrumental] = useState(false);
  const [creativity, setCreativity] = useState(25);
  const [songData, setSongData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [error, setError] = useState(null);
  
  const creativityLevels = {
    0: 'Identical',
    25: 'Subtle',
    50: 'Inspired',
    75: 'Experimental',
    100: 'Wildcard',
  };

  useEffect(() => {
    if (artists.length > 0 && !artists.some(a => String(a.id) === selectedArtistId)) {
        setSelectedArtistId(String(artists[0].id));
    } else if (artists.length === 0) {
        setSelectedArtistId("");
    }
  }, [artists, selectedArtistId]);
  
  const handleSuggestTheme = useCallback(async () => {
    const selectedArtist = artists.find(a => a.id === Number(selectedArtistId));
    if (!selectedArtist) {
      setError("Please select an artist to get a theme suggestion.");
      return;
    }

    setIsSuggesting(true);
    setError(null);
    
    try {
        const artistHistory = generationHistory[selectedArtistId] || {};
        let prompt = `You are a creative muse for songwriters. The artist is "${selectedArtist.name}" and their style is "${selectedArtist.style}". Generate a single, concise, and evocative song theme or concept. The theme should be a short phrase, perfect for inspiring a song. CRITICAL: The final output must start with either "a song about" or "a track about". Do not add any other preamble, explanation, or quotation marks. For example: "a song about a forgotten astronaut watching Earth from afar".`;
        
        if (artistHistory.themes?.length > 0) {
            prompt += `\n\nIMPORTANT: Avoid themes similar to these past suggestions for this artist: "${artistHistory.themes.join('", "')}". Be original.`;
        }

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });
        
        const suggestedTheme = response.text.trim();
        setComment(suggestedTheme);
        
        setGenerationHistory(prev => {
            const newHistory = { ...prev };
            const artistId = selectedArtist.id;
            if (!newHistory[artistId]) {
                newHistory[artistId] = { titles: [], themes: [], lyrics: [] };
            }
            newHistory[artistId].themes.push(suggestedTheme);
            return newHistory;
        });

    } catch (e) {
      console.error("Error suggesting theme:", e);
      setError("Failed to suggest a theme. Please try again.");
    } finally {
      setIsSuggesting(false);
    }
  }, [selectedArtistId, artists, ai, generationHistory, setGenerationHistory]);
  
  const handleGenerate = useCallback(async () => {
    const selectedArtist = artists.find(a => a.id === Number(selectedArtistId));
    if (!selectedArtist) {
      setError("Please select an artist.");
      return;
    }

    setIsLoading(true);
    setSongData(null);
    setError(null);
    
    const getCreativityInstruction = (level) => {
        switch (level) {
            case 0:
                return `The musical style of the song MUST be "Identical" to: "${selectedArtist.style}". Do not deviate or add any other stylistic elements.`;
            case 25:
                return `The musical style should be "Subtle". It must be very close to "${selectedArtist.style}", but with a single, subtle new element. For example, add a slightly different rhythmic feel or a new, complementary instrument, while keeping the core identity intact.`;
            case 50:
                return `The musical style should be "Inspired". It must be inspired by "${selectedArtist.style}", but feel free to add a unique twist or variation. It should be recognizable as the artist, but clearly a new take on their sound. This is the default creative level.`;
            case 75:
                return `The musical style must be an "Experimental" FUSION. Start with the artist's core style ("${selectedArtist.style}"), and blend it with a surprising but coherent genre. For example, if the artist is 'Synthwave', you could blend it with 'Sea Shanty' or 'Baroque'. Be creative and bold.`;
            case 100:
                return `The musical style should be a "Wildcard". Take the artist's core style ("${selectedArtist.style}") as a distant starting point and create something wildly experimental and avant-garde. The connection to the original style might be abstract or purely conceptual. This is a chance for a completely unpredictable and high-concept result.`;
            default:
                return `The musical style should be INSPIRED BY "${selectedArtist.style}", but with its own unique variation or twist. It should be recognizable as the artist, but clearly a new take on their sound.`;
        }
    };

    const creativityInstruction = getCreativityInstruction(creativity);
    const artistHistory = generationHistory[selectedArtistId] || {};
    let historyConstraints = "";
    if (artistHistory.titles?.length > 0) {
        historyConstraints += `\n\nCRITICAL: Be creative and original. Avoid generating a song concept similar to these past titles for this artist: "${artistHistory.titles.join('", "')}".`;
    }
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
      prompt = `You are a songwriter for the artist "${selectedArtist.name}". Their signature style is: "${selectedArtist.style}".\n`;
      prompt += `Your task is to generate a complete CONCEPT FOR AN INSTRUMENTAL-ONLY song that fits this artist.\n`;
      prompt += `${creativityInstruction}\n`;

      if (comment) {
        prompt += `Use the following idea or theme for the instrumental's mood: "${comment}".\n`;
      } else {
        prompt += `The theme and mood must be completely new and original.\n`;
      }
      
      prompt += historyConstraints;

      prompt += `The output must be a song concept with a title, a musical style description (MAXIMUM 250 characters), and a detailed structural description for Suno.\n`;
      prompt += `CRITICAL RULE: The structural description in the 'lyrics' field MUST NOT contain any singable words or lyrics. It should only describe the musical sections, instruments, and arrangement.\n`;
      prompt += `IMPORTANT: Format the structural description in a structure readable by Suno for instrumental tracks. This means including tags for song sections like [Intro], [Verse], [Chorus], [Bridge], [Outro], etc. and descriptive musical and instrumental cues in square brackets, for example: [soft piano intro with atmospheric pads] or [energetic synth lead over a driving bassline].\n`;
      prompt += `CRITICAL FORMATTING RULE: ALWAYS add a blank line between song sections (e.g., between the end of the [Intro] section and the start of the [Verse] section). This is mandatory for readability.\n\n`;

      prompt += `Here is a perfect example of the required format for the structural description (to be placed in the 'lyrics' field):\n`;
      prompt += `[Intro]
[8 bars of atmospheric synth pads building up]
[A simple, melancholic piano melody enters]

[Verse]
[The beat kicks in with a steady lo-fi drum machine]
[A warm, deep bassline carries the harmony]
[The piano melody continues, slightly more complex]

[Chorus]
[The energy lifts with layered synths and a soaring lead melody]
[The drums become more powerful with a driving kick and snare]
[A subtle string section adds emotional depth]

[Outro]
[The main elements fade out one by one, starting with the drums]
[The song ends with the initial piano melody and a final, lingering synth pad chord]
`;
      
      responseSchema = {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "The title of the instrumental song." },
          style: { type: Type.STRING, description: "The musical style of the song, inspired by the artist. Maximum 250 characters." },
          lyrics: { type: Type.STRING, description: "A detailed structural description for an instrumental song, formatted for Suno. Must not contain any singable lyrics." },
        },
        required: ["title", "style", "lyrics"],
      };

    } else {
      prompt = `You are a songwriter for the artist "${selectedArtist.name}". Their signature style is: "${selectedArtist.style}".\n`;
      prompt += `Your task is to generate a complete song concept that fits this artist.\n`;
      prompt += `${creativityInstruction}\n`;

      if (comment) {
        prompt += `Use the following idea or theme: "${comment}".\n`;
      } else {
        prompt += `The theme and lyrics must be completely new and original, telling a different story from any previous request for this artist.\n`;
      }
      
      prompt += historyConstraints;
      
      prompt += `The output must be a song with a title, a musical style description (MAXIMUM 250 characters), and full lyrics.\n`;
      prompt += `CRITICAL RULE: The lyrics MUST NOT mention the artist's name or the song's genre/style. The story and emotion should stand on their own.\n`;
      prompt += `The lyrics must be in English unless another language is explicitly requested in the comment.\n\n`;
      
      prompt += `IMPORTANT: Format the lyrics in a structure readable by Suno. This means including tags for song sections like (Intro), [Verse 1], (Chorus), (Pre-Chorus), [Bridge], (Outro), etc. Also, include descriptive musical and instrumental cues in square brackets, for example: [soft piano intro] or [upbeat synth solo with heavy drums].\n`;
      prompt += `CRITICAL FORMATTING RULE: ALWAYS add a blank line between song sections (e.g., between the end of the (Chorus) section and the start of the [Verse 2] section). This is mandatory for readability.\n\n`;
      
      prompt += `Here is a perfect example of the required lyrics format:\n`;
      prompt += `(Intro)

[2 bars – filtered funk guitar + handclaps; subby kick building; short brass stab cue. One-shot “Uh!” ad-lib.]

(Verse 1)
I walk in slow, gold hoops, midnight glitter
Beat says “go,” my pulse moves quicker
I don’t chase love, I choose the rhythm
Snap of the snare and I’m locked in the prism
Side-eye sparkle, sugar on the lips
Bassline talking, hands on the hips
If you want the fire, say my name right now
I turn the room to a holy vow

(Pre-Chorus)
Hands up (hey), bass low (hey)
Lights down—here we go
Can’t fake what we came here for
One spark, then we’re wanting more

(Chorus)
I put the fever on the floor
Turn you up and give you more
Honey-drip through every chord
Say my name and watch me roar
I put the fever on the floor
From the ceiling to the door
You can’t fight it, don’t ignore—
I’m the heat you’re looking for

(Post-Chorus / Hook)
Heatwave—oh! (heatwave)
Make your heartbeat misbehave
Heatwave—yeah! (heatwave)
Let the heavy beat pave the way

(Verse 2)
Velvet thunder, 808s collide
Rhythm like a taxi, “Baby, get inside”
I’m champagne sparkle with a razor edge
Sweet like the chorus, wild like the bridge
Little bit of trouble in a cherry gloss
Turn a quiet Tuesday to a total boss
If you feel the fever, better lean in close—
I’m a one-girl party and the world’s my host

(Optional Rap – same singer)
Tap in—heels click, metronome killer,
Independent credit, I’m the headline filler,
Two-step slick with a capital S,
Pay me in respect and a wireless check,
No cap—clap track, double-time hi-hat,
Bass got a face like “who did that?”
Glow so loud it invades your shade—
I sell out silence with the noise I made.

(Pre-Chorus)
Hands up (hey), bass low (hey)
Lights down—here we go
Can’t fake what we came here for
One spark, then we’re wanting more

(Chorus)
I put the fever on the floor
Turn you up and give you more
Honey-drip through every chord
Say my name and watch me roar
I put the fever on the floor
From the ceiling to the door
You can’t fight it, don’t ignore—
I’m the heat you’re looking for

[Drop to kick + claps + talkbox/vocoder answering the lead. Call-and-response.]
You say — (name) / I light your— (flame)
We bend that— (time) / We play no— (games)
Slow it— (down) / bring it— (back)
When it hits— (hits) / Now to

[Drop to kick + claps + talkbox/vocoder answering the lead. Call-and-response.]
You say my— (name) / I light your— (flame)
We bend that— (time) / We play no— (games)
Slow it— (down) / bring it— (back)
When it hits— (hits) /Now to

I put the fever on the floor
From the ceiling to the door
You can’t fight it, don’t ignore—
I’m the heat you’re looking for

(Post-Chorus / Hook)
Heatwave—oh! (heatwave)
I put the fever on the floor
Turn you up and give you more
Honey-drip through every chord
Say my name and watch me roar
I put the fever on the floor
From the ceiling to the door
You can’t fight it, don’t ignore—
I’m the heat you’re looking for

(Post-Chorus / Hook)
Heatwave—oh! (heatwave)
`;
      
      responseSchema = {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "The title of the song." },
          style: { type: Type.STRING, description: "The musical style of the song, inspired by the artist. Maximum 250 characters." },
          lyrics: { type: Type.STRING, description: "The full lyrics of the song, following Suno format. Must not contain the artist's name or genre." },
        },
        required: ["title", "style", "lyrics"],
      };
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
        },
      });
      
      const responseText = response.text.trim();
      const parsedData = JSON.parse(responseText);
      setSongData(parsedData);
      
      setGenerationHistory(prev => {
        const newHistory = { ...prev };
        const artistId = selectedArtist.id;
        if (!newHistory[artistId]) {
            newHistory[artistId] = { titles: [], themes: [], lyrics: [] };
        }
        newHistory[artistId].titles.push(parsedData.title);
        newHistory[artistId].lyrics.push(parsedData.lyrics);
        return newHistory;
      });

    } catch (e) {
      console.error("Error generating song:", e);
      setError("Failed to generate the song. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedArtistId, comment, artists, ai, isInstrumental, generationHistory, setGenerationHistory, creativity]);
  
  const handleCopy = useCallback(async (content, buttonId) => {
    const button = document.getElementById(buttonId);
    if (!content || !button) return;
    try {
      await navigator.clipboard.writeText(content);
      const originalText = button.textContent;
      button.textContent = "Copied!";
      button.classList.add('copied');
      setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove('copied');
      }, 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
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
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional comment (e.g., a song about a lost city)"
            aria-label="Optional comment"
          />
           <button 
              onClick={handleSuggestTheme} 
              className="btn-suggest" 
              title="Suggest a theme"
              disabled={isSuggesting || artists.length === 0 || !selectedArtistId}
          >
              {isSuggesting ? (
                  <div className="spinner-small"></div>
              ) : (
                  '💡'
              )}
          </button>
        </div>
        <div className="instrumental-checkbox">
            <input 
              type="checkbox" 
              id="instrumental" 
              checked={isInstrumental} 
              onChange={(e) => setIsInstrumental(e.target.checked)}
            />
            <label htmlFor="instrumental">Instrumental</label>
        </div>
        <div className="creativity-slider-container">
            <label htmlFor="creativity">Creativity Level: <span className="creativity-level-label">{creativityLevels[creativity]}</span></label>
            <input
                type="range"
                id="creativity"
                min="0"
                max="100"
                step="25"
                value={creativity}
                onChange={(e) => setCreativity(Number(e.target.value))}
            />
        </div>
        <button className="btn btn-generate" onClick={handleGenerate} disabled={isLoading || artists.length === 0}>
          {isLoading ? 'Generating...' : '✨ Generate Song'}
        </button>
      </div>

      {error && <div className="error-message" role="alert">{error}</div>}

      <div className="results-container">
        {isLoading && <div className="spinner-overlay"><div className="spinner"></div></div>}
        
        {!isLoading && !songData && (
          <div className="placeholder-results">
            Your generated song will appear here.
          </div>
        )}
        
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

const ApiKeyEntryView = ({ onApiKeySubmit }) => {
  const [key, setKey] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (key.trim()) {
      onApiKeySubmit(key.trim());
    }
  };

  return (
    <div className="api-key-entry-view">
      <form onSubmit={handleSubmit} className="form-card">
        <h3>Welcome to Suno Machine</h3>
        <p>
          Please enter your Google AI API key to begin. Your key will be stored
          securely in your browser's local storage.
        </p>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Paste your API key here"
          aria-label="Google AI API Key"
          required
        />
        <button type="submit" className="btn btn-primary">
          Start Creating
        </button>
        <a 
          href="https://aistudio.google.com/app/apikey" 
          target="_blank" 
          rel="noopener noreferrer"
        >
          Don't have a key? Get one from Google AI Studio
        </a>
      </form>
    </div>
  );
};

// --- Main App Component ---
const App = () => {
  const [view, setView] = useState('create');
  const [artists, setArtists] = useState(() => {
    try {
      const savedArtists = localStorage.getItem('sunoArtists');
      const parsed = savedArtists ? JSON.parse(savedArtists) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [generationHistory, setGenerationHistory] = useState(() => {
    try {
      const savedHistory = localStorage.getItem('sunoGenerationHistory');
      return savedHistory ? JSON.parse(savedHistory) : {};
    } catch {
      return {};
    }
  });
  const [ai, setAi] = useState(null);

  useEffect(() => {
    localStorage.setItem('sunoArtists', JSON.stringify(artists));
  }, [artists]);

  useEffect(() => {
    localStorage.setItem('sunoGenerationHistory', JSON.stringify(generationHistory));
  }, [generationHistory]);

  useEffect(() => {
    const key = localStorage.getItem('google-api-key');
    if (key) {
      try {
        setAi(new GoogleGenAI({ apiKey: key }));
      } catch (e) {
        console.error("Error initializing AI with saved key:", e);
        localStorage.removeItem('google-api-key');
      }
    }
  }, []);

  const handleApiKeySubmit = (key) => {
    try {
      const newAi = new GoogleGenAI({ apiKey: key });
      localStorage.setItem('google-api-key', key);
      setAi(newAi);
    } catch (e) {
      alert('Invalid API key or initialization failed. Please check the console for details.');
      console.error(e);
    }
  };
  
  const handleClearApiKey = () => {
    localStorage.removeItem('google-api-key');
    setAi(null);
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
        {ai && (
            <div className="header-actions">
                <button onClick={handleClearApiKey} className="btn btn-clear-key">Clear API Key</button>
            </div>
        )}
      </header>
      {!ai ? (
        <ApiKeyEntryView onApiKeySubmit={handleApiKeySubmit} />
      ) : (
        <>
          <nav className="view-switcher">
            <button className={`btn ${view === 'create' ? 'active' : ''}`} onClick={() => setView('create')}>Create Song</button>
            <button className={`btn ${view === 'manage' ? 'active' : ''}`} onClick={() => setView('manage')}>Manage Artists</button>
          </nav>
          {view === 'create' ? <CreateSongView artists={artists} ai={ai} generationHistory={generationHistory} setGenerationHistory={setGenerationHistory} /> : <ManageArtistsView artists={artists} setArtists={setArtists} ai={ai} generationHistory={generationHistory} setGenerationHistory={setGenerationHistory} />}
        </>
      )}
    </main>
  );
};


const ResultCard = ({ id, title, content, onCopy, isLarge = false }) => (
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

const root = createRoot(document.getElementById("root"));
root.render(<App />);