/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Type } from "@google/genai";

// --- Artist Management View ---
const ManageArtistsView = ({ artists, setArtists }) => {
  const [editingArtist, setEditingArtist] = useState(null);
  const [formName, setFormName] = useState("");
  const [formStyle, setFormStyle] = useState("");
  const [formError, setFormError] = useState("");
  const [aiComment, setAiComment] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const fileInputRef = useRef(null);

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

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
    if (window.confirm("Are you sure you want to delete this artist?")) {
      setArtists(prev => prev.filter((a) => a.id !== id));
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

        // Fix: Cast importedArtists to any[] to safely access properties on parsed JSON objects. This resolves errors on unknown types.
        const validArtists = (importedArtists as any[])
          .filter(artist => artist && typeof artist.name === 'string' && artist.name.trim() !== '' && typeof artist.style === 'string')
          .map(artist => ({ ...artist, name: artist.name.trim() }));

        if (validArtists.length === 0) {
            alert("No valid artist data found in the file.");
            return;
        }

        setArtists(prevArtists => {
            const artistMap = new Map(prevArtists.map(a => [a.name.toLowerCase(), a]));
            let localAddedCount = 0;
            let localUpdatedCount = 0;
            
            validArtists.forEach(importedArtist => {
                const key = importedArtist.name.toLowerCase();
                const existingArtist = artistMap.get(key);

                if (existingArtist) {
                    if (existingArtist.style !== importedArtist.style) {
                        artistMap.set(key, { ...existingArtist, style: importedArtist.style });
                        localUpdatedCount++;
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
                    Import
                </button>
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    style={{ display: "none" }}
                    accept=".json"
                />
                <button className="btn btn-secondary" onClick={handleExport} disabled={artists.length === 0}>
                    Export
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
const CreateSongView = ({ artists }) => {
  const [selectedArtistId, setSelectedArtistId] = useState("");
  const [comment, setComment] = useState("");
  const [songData, setSongData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  useEffect(() => {
    if (artists.length > 0 && !artists.some(a => String(a.id) === selectedArtistId)) {
        setSelectedArtistId(String(artists[0].id));
    } else if (artists.length === 0) {
        setSelectedArtistId("");
    }
  }, [artists, selectedArtistId]);
  
  const handleGenerate = useCallback(async () => {
    const selectedArtist = artists.find(a => a.id === Number(selectedArtistId));
    if (!selectedArtist) {
      setError("Please select an artist.");
      return;
    }

    setIsLoading(true);
    setSongData(null);
    setError(null);
    
    let prompt = `You are a songwriter for the artist "${selectedArtist.name}". Their signature style is: "${selectedArtist.style}".\n`;
    prompt += `Your task is to generate a complete song concept that fits this artist.\n`;
    prompt += `The musical style of the song should be INSPIRED BY the artist's main style, but with its own unique variation or twist. Do not simply repeat the artist's style.\n`;

    if (comment) {
      prompt += `Use the following idea or theme: "${comment}".\n`;
    } else {
      prompt += `The theme and lyrics must be completely new and original, telling a different story from any previous request for this artist.\n`;
    }
    
    prompt += `The output must be a song with a title, a musical style description (MAXIMUM 250 characters), and full lyrics.\n`;
    prompt += `CRITICAL RULE: The lyrics MUST NOT mention the artist's name or the song's genre/style. The story and emotion should stand on their own.\n`;
    prompt += `The lyrics must be in English unless another language is explicitly requested in the comment.\n\n`;
    
    prompt += `IMPORTANT: Format the lyrics in a structure readable by Suno. This means including tags for song sections like (Intro), [Verse 1], (Chorus), (Pre-Chorus), [Bridge], (Outro), etc. Also, include descriptive musical and instrumental cues in square brackets, for example: [soft piano intro] or [upbeat synth solo with heavy drums].\n\n`;
    
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

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: "The title of the song." },
              style: { type: Type.STRING, description: "The musical style of the song, inspired by the artist. Maximum 250 characters." },
              lyrics: { type: Type.STRING, description: "The full lyrics of the song, following Suno format. Must not contain the artist's name or genre." },
            },
            required: ["title", "style", "lyrics"],
          },
        },
      });
      
      const responseText = response.text.trim();
      const parsedData = JSON.parse(responseText);
      setSongData(parsedData);

    } catch (e) {
      console.error("Error generating song:", e);
      setError("Failed to generate the song. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedArtistId, comment, artists]);
  
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
        <input
          type="text"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Optional comment (e.g., a song about a lost city)"
          aria-label="Optional comment"
        />
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

  useEffect(() => {
      localStorage.setItem('sunoArtists', JSON.stringify(artists));
  }, [artists]);

  return (
    <main>
      <header>
        <div className="logo">
            <svg width="48" height="48" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="50" cy="50" r="48" stroke="currentColor" strokeWidth="4"/>
                <path d="M20 50 Q 30 25, 40 50 T 60 50 T 80 50" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
            </svg>
            <h1>Suno Machine</h1>
        </div>
        <p>Your AI-powered song creation studio</p>
      </header>

      <nav className="view-switcher">
        <button className={`btn ${view === 'create' ? 'active' : ''}`} onClick={() => setView('create')}>Create Song</button>
        <button className={`btn ${view === 'manage' ? 'active' : ''}`} onClick={() => setView('manage')}>Manage Artists</button>
      </nav>
      
      {view === 'create' ? <CreateSongView artists={artists} /> : <ManageArtistsView artists={artists} setArtists={setArtists}/>}

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
