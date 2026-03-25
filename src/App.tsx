import { useState, useRef, useEffect, FormEvent } from 'react';
import { GoogleGenAI } from '@google/genai';
import { articleTitle, articleAuthor, articleDate, articleContent } from './articleData';
import Markdown from 'react-markdown';
import { Clock, Sparkles, Loader2, X, MessageCircleQuestion, Send, Presentation, ChevronLeft, ChevronRight, Settings } from 'lucide-react';

type ModalMode = 'summary' | 'qa' | 'slideshow' | 'settings' | null;
type ChatMessage = { role: 'user' | 'ai'; text: string };
type Slide = { 
  title: string; 
  oneLineDescription: string;
  paragraphSummary: string;
  bulletPoints: string[];
  imageUrl: string; 
};
type Theme = 'light' | 'dark';
type FontSize = 'small' | 'medium' | 'large';

function SummaryDepthButton({ title, time, lines, selected, onClick }: { title: string, time: string, lines: number[], selected: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-[9px_12px] rounded-[8px] transition-colors text-left ${selected ? 'bg-citrus-mid' : 'bg-citrus-light hover:bg-citrus-mid/80'}`}
    >
      <div className="flex flex-col gap-[3px] w-[20px] shrink-0">
        {lines.map((width, i) => (
          <div key={i} className="h-[2px] bg-citrus-text rounded-full" style={{ width: `${width}px` }} />
        ))}
      </div>
      <div className="flex flex-col">
        <span className="text-[12px] font-medium text-citrus-text leading-tight">{title}</span>
        <span className="text-[10px] text-citrus-hover-text leading-tight mt-0.5">{time}</span>
      </div>
    </button>
  );
}

export default function App() {
  const [summary, setSummary] = useState<string | null>(null);
  const [loadingSummary, setLoadingSummary] = useState<boolean>(false);
  const [summaryTime, setSummaryTime] = useState<string | null>(null);
  
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  
  // Slideshow State
  const [slides, setSlides] = useState<Slide[]>([]);
  const [loadingSlides, setLoadingSlides] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);

  // Settings State
  const [theme, setTheme] = useState<Theme>('light');
  const [fontSize, setFontSize] = useState<FontSize>('medium');

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Q&A State
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Tooltip State
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [loadingExplanation, setLoadingExplanation] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const [scrollProgress, setScrollProgress] = useState(0);

  const wordCount = articleContent.split(/\s+/).length;
  const readingTimeMinutes = Math.ceil(wordCount / 200);

  const toc = articleContent.match(/^#\s+(.*)$/gm)?.map(h => {
    const text = h.replace(/^#\s+/, '');
    const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return { text, id };
  }) || [];

  useEffect(() => {
    const handleScroll = () => {
      const totalScroll = document.documentElement.scrollTop;
      const windowHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      if (windowHeight > 0) {
        setScrollProgress((totalScroll / windowHeight) * 100);
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Tooltip Logic
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      if (tooltipRef.current && tooltipRef.current.contains(e.target as Node)) {
        return; // Clicked inside tooltip
      }

      setTimeout(() => {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) {
          const text = sel.toString().trim();
          if (text.length > 0 && text.length < 60) {
            const range = sel.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            setSelection({ 
              text, 
              x: rect.left + rect.width / 2 + window.scrollX, 
              y: rect.top + window.scrollY 
            });
            fetchExplanation(text);
          } else {
            setSelection(null);
          }
        } else {
          setSelection(null);
        }
      }, 10);
    };

    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const fetchExplanation = async (text: string) => {
    setLoadingExplanation(true);
    setExplanation(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `Briefly define or explain the term "${text}" in the context of this article excerpt. Keep it to 1-2 short sentences.\n\nExcerpt: ${articleContent.substring(0, 3000)}`;
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });
      setExplanation(response.text || 'No explanation found.');
    } catch (error) {
      console.error(error);
      setExplanation('Failed to load explanation.');
    } finally {
      setLoadingExplanation(false);
    }
  };

  // Summary Logic
  const generateSlides = async () => {
    setModalMode('slideshow');
    if (slides.length > 0) return;
    setLoadingSlides(true);
    setCurrentSlide(0);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const parts = articleContent.split(/(?=# Part \d:)/).filter(p => p.trim().length > 0).slice(0, 4);
      
      const generatedSlides: Slide[] = [];
      
      for (const part of parts) {
        const titleMatch = part.match(/# (Part \d: [^\n]+)/);
        const title = titleMatch ? titleMatch[1] : 'Section';
        
        let parsed = {
          oneLineDescription: "Summary not available.",
          paragraphSummary: "Could not generate summary.",
          bulletPoints: ["Point 1", "Point 2", "Point 3"]
        };

        try {
          const summaryResponse = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Analyze this section and provide a JSON response with the following fields:
- "oneLineDescription": A very short 1-line description (under 10 words).
- "paragraphSummary": A short paragraph summary (2-3 sentences).
- "bulletPoints": An array of exactly 3 short bullet points.

Section:\n\n${part}`,
            config: {
              responseMimeType: "application/json",
            }
          });
          parsed = JSON.parse(summaryResponse.text || '{}');
        } catch (e) {
          console.error("Text generation failed", e);
        }
        
        let imageUrl = '';
        try {
          const imageResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
              parts: [
                { text: `A modern, editorial illustration representing: ${title}. Minimalist, corporate tech meets environmental crisis, muted colors, infographic style.` }
              ]
            }
          });
          
          if (imageResponse.candidates?.[0]?.content?.parts) {
            for (const p of imageResponse.candidates[0].content.parts) {
              if (p.inlineData) {
                imageUrl = `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`;
              }
            }
          }
        } catch (imgErr) {
          console.error("Image generation failed for", title, imgErr);
        }
        
        generatedSlides.push({ 
          title, 
          oneLineDescription: parsed.oneLineDescription || '',
          paragraphSummary: parsed.paragraphSummary || '',
          bulletPoints: parsed.bulletPoints || [],
          imageUrl 
        });
        setSlides([...generatedSlides]);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingSlides(false);
    }
  };

  const generateSummary = async (time: '30s' | '1m' | '3m') => {
    setLoadingSummary(true);
    setSummaryTime(time);
    setSummary(null);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      let wordLimit = 100;
      if (time === '1m') wordLimit = 200;
      if (time === '3m') wordLimit = 600;

      const prompt = `Summarize the following article in approximately ${wordLimit} words. Make it engaging and informative.\n\nArticle:\n${articleContent}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });

      setSummary(response.text || 'Failed to generate summary.');
    } catch (error) {
      console.error(error);
      setSummary('An error occurred while generating the summary.');
    } finally {
      setLoadingSummary(false);
    }
  };

  // Q&A Logic
  const handleAskQuestion = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentQuestion.trim()) return;

    const newHistory: ChatMessage[] = [...chatHistory, { role: 'user', text: currentQuestion }];
    setChatHistory(newHistory);
    setCurrentQuestion('');
    setIsChatting(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `You are an AI reading assistant helping a reader understand an investigative article.\n\nArticle Content:\n${articleContent}\n\nUser Question: ${currentQuestion}\n\nAnswer the question based ONLY on the provided article. Be concise, helpful, and direct.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });

      setChatHistory([...newHistory, { role: 'ai', text: response.text || 'Sorry, I could not generate an answer.' }]);
    } catch (error) {
      console.error(error);
      setChatHistory([...newHistory, { role: 'ai', text: 'An error occurred while fetching the answer.' }]);
    } finally {
      setIsChatting(false);
    }
  };

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, isChatting, modalMode]);

  const openModal = (mode: ModalMode, time?: '30s' | '1m' | '3m') => {
    setModalMode(mode);
    if (mode === 'summary' && time) {
      generateSummary(time);
    }
  };

  const closeModal = () => {
    setModalMode(null);
  };

  return (
    <div className="min-h-screen bg-ink-bg text-ink-text font-sans selection:bg-citrus-light pb-24 lg:pb-0 relative">
      {/* Progress Bar */}
      <div className="fixed top-0 left-0 right-0 h-[4px] bg-citrus-light z-50">
        <div className="h-full bg-citrus-mid transition-all duration-150 ease-out" style={{ width: `${scrollProgress}%` }} />
      </div>

      {/* Navigation Bar */}
      <nav className="sticky top-[4px] z-40 bg-ink-bg border-b-[0.5px] border-ink-border px-[20px] py-[12px] flex justify-between items-center">
        <div className="flex items-center">
          <span className="text-ink-text font-medium text-[15px] tracking-tight">deep</span>
          <span className="bg-citrus-mid text-citrus-text px-1.5 py-0.5 rounded-[4px] text-[15px] font-medium tracking-tight ml-[2px]">read</span>
        </div>
        <div className="flex items-center gap-4 text-ink-muted text-[13px]">
          <a href="#" className="hover:text-ink-text transition-colors">Library</a>
          <button onClick={() => setModalMode('settings')} className="hover:text-ink-text transition-colors">Settings</button>
        </div>
      </nav>

      {/* Tooltip */}
      {selection && (
        <div
          ref={tooltipRef}
          className="absolute z-50 max-w-xs bg-ink-text text-ink-surface p-3 rounded-xl shadow-xl text-sm font-sans animate-in fade-in zoom-in-95 duration-200"
          style={{
            left: `${selection.x}px`,
            top: `${selection.y - 10}px`,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="font-medium text-citrus-mid mb-1 border-b border-ink-muted pb-1">
            {selection.text}
          </div>
          {loadingExplanation ? (
            <div className="flex items-center gap-2 text-ink-muted py-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span className="text-xs">Explaining...</span>
            </div>
          ) : (
            <div className="text-ink-surface leading-relaxed">
              {explanation}
            </div>
          )}
          <div className="absolute left-1/2 -bottom-2 -translate-x-1/2 border-4 border-transparent border-t-ink-text"></div>
        </div>
      )}

      <main className="max-w-6xl mx-auto flex flex-col lg:flex-row min-h-screen">
        {/* Article Column (Left) */}
        <article className="w-full lg:w-[65%] lg:border-r-[0.5px] border-ink-border p-[24px_28px] md:p-[40px_48px]">
          <div className="mb-12">
            <div className="inline-block bg-citrus-mid text-citrus-text text-[12px] font-medium px-3 py-1 rounded-[20px] mb-6">
              {readingTimeMinutes} min read
            </div>
            <h1 className="text-[32px] md:text-[42px] font-medium text-ink-text leading-[1.15] mb-4 tracking-tight">
              {articleTitle}
            </h1>
            <p className="text-[14px] md:text-[15px] text-ink-muted">
              By {articleAuthor} &middot; {articleDate}
            </p>
          </div>
          
          <div className="font-sans">
            <Markdown
              components={{
                h1: ({node, children, ...props}) => {
                  const text = String(children);
                  const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                  return (
                    <div id={id} className="flex items-center gap-3 mt-12 mb-5 scroll-mt-24">
                      <div className="w-[8px] h-[8px] bg-citrus-mid rounded-[2px] shrink-0" />
                      <h2 className={`${fontSize === 'small' ? 'text-[16px] md:text-[20px]' : fontSize === 'large' ? 'text-[20px] md:text-[24px]' : 'text-[18px] md:text-[22px]'} font-medium text-ink-text m-0 tracking-tight`} {...props}>{children}</h2>
                    </div>
                  );
                },
                p: ({node, ...props}) => (
                  <p className={`${fontSize === 'small' ? 'text-[13px] md:text-[14px]' : fontSize === 'large' ? 'text-[17px] md:text-[18px]' : 'text-[15px] md:text-[16px]'} text-ink-body leading-[1.8] ml-[20px] mb-6`} {...props} />
                ),
                blockquote: ({node, ...props}) => (
                  <blockquote className={`bg-citrus-light border-l-[3px] border-citrus-mid rounded-r-md p-[16px_20px] ${fontSize === 'small' ? 'text-[13px] md:text-[14px]' : fontSize === 'large' ? 'text-[17px] md:text-[18px]' : 'text-[15px] md:text-[16px]'} italic text-citrus-text leading-[1.6] ml-[20px] mb-6 my-0`} {...props} />
                ),
                hr: () => <hr className="my-10 border-ink-border ml-[20px]" />
              }}
            >
              {articleContent}
            </Markdown>
          </div>
        </article>

        {/* Sidebar (Right) */}
        <aside className="w-full lg:w-[35%] p-[20px_18px] bg-ink-bg">
          <div className="sticky top-[80px] flex flex-col gap-6">
            {/* Table of Contents Card */}
            <div className="bg-ink-surface border-[0.5px] border-ink-border border-l-[3px] border-l-citrus-mid rounded-r-[8px] p-[16px] shadow-sm">
              <div className="inline-block bg-citrus-mid text-citrus-text text-[11px] font-medium px-2.5 py-0.5 rounded-[3px] tracking-[0.04em] mb-5">
                Table of contents
              </div>
              <ul className="space-y-4">
                {toc.map((item, i) => (
                  <li key={i} className="flex items-start gap-[8px]">
                    <div className="w-[5px] h-[5px] rounded-full bg-citrus-mid shrink-0 mt-[8px]" />
                    <a 
                      href={`#${item.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth' });
                      }}
                      className="text-[13px] text-ink-body hover:text-citrus-hover-text leading-[1.6] m-0 transition-colors underline-offset-2 hover:underline"
                    >
                      {item.text}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Summary Depth Selector */}
            <div>
              <div className="text-[11px] text-[#888888] font-medium mb-3">
                Summary depth
              </div>
              <div className="flex flex-col gap-[6px]">
                <SummaryDepthButton 
                  title="Just the gist" 
                  time="30 sec read" 
                  lines={[12, 8]} 
                  selected={summaryTime === '30s'} 
                  onClick={() => openModal('summary', '30s')} 
                />
                <SummaryDepthButton 
                  title="The highlights" 
                  time="1 min read" 
                  lines={[12, 16, 10]} 
                  selected={summaryTime === '1m'} 
                  onClick={() => openModal('summary', '1m')} 
                />
                <SummaryDepthButton 
                  title="Deep dive" 
                  time="3 min read" 
                  lines={[14, 16, 12, 16, 10]} 
                  selected={summaryTime === '3m'} 
                  onClick={() => openModal('summary', '3m')} 
                />
              </div>
            </div>

            {/* Additional Actions (Preserved Functionality) */}
            <div className="pt-4 border-t border-ink-border flex flex-col gap-3">
              <button 
                onClick={() => openModal('qa')}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-ink-surface border border-ink-border text-ink-text hover:bg-citrus-light hover:border-citrus-light rounded-xl transition-colors text-sm font-medium"
              >
                <MessageCircleQuestion className="w-4 h-4" />
                <span>Ask AI a Question</span>
              </button>
              <button 
                onClick={generateSlides}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-ink-text text-ink-surface hover:bg-citrus-mid hover:text-citrus-text rounded-xl transition-colors text-sm font-medium"
              >
                <Presentation className="w-4 h-4" />
                <span>View Visual Overview</span>
              </button>
            </div>
          </div>
        </aside>
      </main>

      {/* AI Assistant Modal */}
      {modalMode && (
        <div className="fixed inset-0 bg-ink-text/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 sm:p-6">
          <div className="bg-ink-bg w-full max-w-3xl h-[85vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-ink-border">
            {/* Header with Tabs */}
            <div className="flex items-center justify-between p-2 border-b border-ink-border bg-ink-bg">
              {modalMode === 'settings' ? (
                <div className="flex items-center gap-2 p-2 pl-4">
                  <Settings className="w-5 h-5 text-ink-text" />
                  <h2 className="text-[16px] font-medium text-ink-text m-0">Settings</h2>
                </div>
              ) : (
                <div className="flex items-center gap-1 p-2">
                  <button
                    onClick={() => setModalMode('summary')}
                    className={`px-4 py-2 rounded-lg font-sans text-sm font-medium transition-colors flex items-center gap-2 ${modalMode === 'summary' ? 'bg-citrus-mid text-citrus-text' : 'text-ink-muted hover:bg-citrus-light hover:text-citrus-hover-text'}`}
                  >
                    <Sparkles className="w-4 h-4" />
                    Summary
                  </button>
                  <button
                    onClick={() => setModalMode('qa')}
                    className={`px-4 py-2 rounded-lg font-sans text-sm font-medium transition-colors flex items-center gap-2 ${modalMode === 'qa' ? 'bg-citrus-mid text-citrus-text' : 'text-ink-muted hover:bg-citrus-light hover:text-citrus-hover-text'}`}
                  >
                    <MessageCircleQuestion className="w-4 h-4" />
                    Q&A
                  </button>
                  <button
                    onClick={() => setModalMode('slideshow')}
                    className={`px-4 py-2 rounded-lg font-sans text-sm font-medium transition-colors flex items-center gap-2 ${modalMode === 'slideshow' ? 'bg-citrus-mid text-citrus-text' : 'text-ink-muted hover:bg-citrus-light hover:text-citrus-hover-text'}`}
                  >
                    <Presentation className="w-4 h-4" />
                    Visuals
                  </button>
                </div>
              )}
              <button 
                onClick={closeModal}
                className="p-3 hover:bg-ink-surface rounded-full transition-colors mr-2 text-ink-muted hover:text-ink-text"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Content Area */}
            <div className="flex-1 overflow-hidden flex flex-col bg-ink-bg rounded-b-3xl">
              {modalMode === 'settings' ? (
                <div className="p-6 md:p-8 overflow-y-auto h-full font-sans text-ink-text flex flex-col gap-8">
                  <div>
                    <h3 className="text-[12px] font-medium text-ink-muted mb-3 uppercase tracking-wider">Theme</h3>
                    <div className="flex gap-3">
                      <button 
                        onClick={() => setTheme('light')}
                        className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors border ${theme === 'light' ? 'bg-citrus-mid text-citrus-text border-citrus-mid' : 'bg-ink-surface text-ink-text border-ink-border hover:bg-citrus-light hover:text-citrus-hover-text hover:border-citrus-light'}`}
                      >
                        Light
                      </button>
                      <button 
                        onClick={() => setTheme('dark')}
                        className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors border ${theme === 'dark' ? 'bg-citrus-mid text-citrus-text border-citrus-mid' : 'bg-ink-surface text-ink-text border-ink-border hover:bg-citrus-light hover:text-citrus-hover-text hover:border-citrus-light'}`}
                      >
                        Dark
                      </button>
                    </div>
                  </div>
                  
                  <div>
                    <h3 className="text-[12px] font-medium text-ink-muted mb-3 uppercase tracking-wider">Text Size</h3>
                    <div className="flex gap-3">
                      <button 
                        onClick={() => setFontSize('small')}
                        className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors border ${fontSize === 'small' ? 'bg-citrus-mid text-citrus-text border-citrus-mid' : 'bg-ink-surface text-ink-text border-ink-border hover:bg-citrus-light hover:text-citrus-hover-text hover:border-citrus-light'}`}
                      >
                        Small
                      </button>
                      <button 
                        onClick={() => setFontSize('medium')}
                        className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors border ${fontSize === 'medium' ? 'bg-citrus-mid text-citrus-text border-citrus-mid' : 'bg-ink-surface text-ink-text border-ink-border hover:bg-citrus-light hover:text-citrus-hover-text hover:border-citrus-light'}`}
                      >
                        Medium
                      </button>
                      <button 
                        onClick={() => setFontSize('large')}
                        className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors border ${fontSize === 'large' ? 'bg-citrus-mid text-citrus-text border-citrus-mid' : 'bg-ink-surface text-ink-text border-ink-border hover:bg-citrus-light hover:text-citrus-hover-text hover:border-citrus-light'}`}
                      >
                        Large
                      </button>
                    </div>
                  </div>
                </div>
              ) : modalMode === 'slideshow' ? (
                <div className="flex-1 overflow-y-auto bg-ink-bg p-6 md:p-8">
                  {slides.length === 0 && loadingSlides ? (
                    <div className="flex flex-col items-center justify-center h-full text-ink-muted font-sans">
                      <Loader2 className="w-8 h-8 animate-spin mb-4 text-citrus-mid" />
                      <p>Generating visual overview...</p>
                    </div>
                  ) : slides.length === 0 && !loadingSlides ? (
                    <div className="flex flex-col items-center justify-center h-full text-ink-muted font-sans">
                      <Presentation className="w-12 h-12 text-ink-muted mb-4" />
                      <p>No visual overview generated yet.</p>
                      <button onClick={generateSlides} className="mt-4 px-4 py-2 bg-citrus-mid text-citrus-text rounded-lg hover:bg-citrus-light transition-colors">
                        Generate Now
                      </button>
                    </div>
                  ) : (
                    <div className="max-w-4xl mx-auto flex flex-col gap-6">
                      {/* Header row */}
                      <div className="flex items-center justify-between">
                        <div>
                          <h2 className="text-[13px] font-medium text-[#111] m-0">Visual overview</h2>
                          <p className="text-[11px] text-[#888] m-0 mt-1">4 sections &middot; tap a card to expand</p>
                        </div>
                        <div className="bg-citrus-mid text-citrus-text text-[10px] font-medium px-2 py-0.5 rounded-[3px]">
                          AI generated
                        </div>
                      </div>

                      {/* Card grid */}
                      <div className="grid grid-cols-4 gap-[10px]">
                        {slides.map((slide, idx) => {
                          const isActive = currentSlide === idx;
                          const isFirst = idx === 0;
                          return (
                            <button
                              key={idx}
                              onClick={() => setCurrentSlide(idx)}
                              className={`flex flex-col text-left bg-[#FFFFFF] rounded-[10px] overflow-hidden transition-all ${
                                isActive ? 'border-[1.5px] border-citrus-mid' : 'border-[0.5px] border-ink-border'
                              }`}
                            >
                              {/* Top zone */}
                              <div 
                                className="relative w-full h-[90px] flex items-center justify-center shrink-0"
                                style={{ backgroundColor: isFirst ? '#EEF7E0' : '#F2F2EE' }}
                              >
                                {slide.imageUrl ? (
                                  <img src={slide.imageUrl} alt="" className="max-w-[40px] max-h-[40px] object-contain" referrerPolicy="no-referrer" />
                                ) : (
                                  <div className="w-[40px] h-[40px] flex items-center justify-center">
                                    {loadingSlides && idx >= slides.length - 1 ? <Loader2 className="w-5 h-5 animate-spin text-ink-muted" /> : null}
                                  </div>
                                )}
                                <div className="absolute bottom-1 right-2 text-[28px] font-medium text-[#E0E0D6] leading-none">
                                  0{idx + 1}
                                </div>
                              </div>
                              {/* Bottom zone */}
                              <div className="p-[10px_12px] flex-1 flex flex-col">
                                <div className="flex items-center gap-1.5 mb-1">
                                  <div className={`w-[5px] h-[5px] bg-citrus-mid rounded-[1px] shrink-0 ${isActive ? 'opacity-100' : 'opacity-0'}`} />
                                  <h3 className="text-[12px] font-medium text-[#111] m-0 truncate">{slide.title.replace(/^Part \d:\s*/, '')}</h3>
                                </div>
                                <p className="text-[11px] text-[#888] m-0 line-clamp-1">{slide.oneLineDescription}</p>
                              </div>
                            </button>
                          );
                        })}
                        {/* Fill empty slots if loading */}
                        {loadingSlides && Array.from({ length: Math.max(0, 4 - slides.length) }).map((_, i) => (
                           <div key={`skeleton-${i}`} className="flex flex-col bg-[#FFFFFF] rounded-[10px] border-[0.5px] border-ink-border overflow-hidden opacity-50">
                             <div className="relative w-full h-[90px] flex items-center justify-center shrink-0 bg-[#F2F2EE]">
                               <Loader2 className="w-5 h-5 animate-spin text-ink-muted" />
                             </div>
                             <div className="p-[10px_12px] flex-1">
                               <div className="h-3 bg-ink-border rounded w-3/4 mb-2"></div>
                               <div className="h-2 bg-ink-border rounded w-full"></div>
                             </div>
                           </div>
                        ))}
                      </div>

                      {/* Expanded panel */}
                      {slides[currentSlide] && (
                        <div className="w-full border-[1.5px] border-citrus-mid rounded-[10px] bg-[#FFFFFF] flex overflow-hidden">
                          {/* Left column */}
                          <div 
                            className="w-[180px] shrink-0 relative flex items-center justify-center"
                            style={{ backgroundColor: currentSlide === 0 ? '#EEF7E0' : '#F2F2EE' }}
                          >
                            {slides[currentSlide].imageUrl && (
                              <img src={slides[currentSlide].imageUrl} alt="" className="max-w-[64px] max-h-[64px] object-contain" referrerPolicy="no-referrer" />
                            )}
                            <div className="absolute bottom-2 right-3 text-[52px] font-medium text-[#E0E0D6] leading-none">
                              0{currentSlide + 1}
                            </div>
                          </div>
                          
                          {/* Right column */}
                          <div className="flex-1 p-[18px_20px]">
                            <div className="inline-block bg-citrus-mid text-citrus-text text-[10px] font-medium px-2 py-0.5 rounded-[3px] mb-[10px]">
                              Section 0{currentSlide + 1}
                            </div>
                            <h3 className="text-[15px] font-medium text-[#111] m-0 mb-[12px]">
                              {slides[currentSlide].title.replace(/^Part \d:\s*/, '')}
                            </h3>
                            <p className="text-[13px] text-[#444] leading-[1.7] m-0 mb-[12px]">
                              {slides[currentSlide].paragraphSummary}
                            </p>
                            <ul className="space-y-[6px] m-0 p-0 list-none">
                              {slides[currentSlide].bulletPoints?.map((pt, i) => (
                                <li key={i} className="flex items-start gap-2">
                                  <div className="w-[5px] h-[5px] rounded-full bg-citrus-mid shrink-0 mt-[6px]" />
                                  <span className="text-[12px] text-[#444] leading-[1.5]">{pt}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}

                      {/* Hint text */}
                      {slides.length > 0 && (
                        <div className="text-center text-[11px] text-[#aaa] mt-2">
                          Tap any card above to explore that section
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : modalMode === 'summary' ? (
                <div className="p-6 md:p-8 overflow-y-auto h-full font-sans text-lg leading-relaxed text-ink-text flex flex-col">
                  <div className="mb-8 flex flex-col gap-[6px]">
                    <div className="text-[11px] text-[#888888] font-medium mb-1">
                      Summary depth
                    </div>
                    <div className="flex gap-3">
                      <SummaryDepthButton 
                        title="Just the gist" 
                        time="30 sec read" 
                        lines={[12, 8]} 
                        selected={summaryTime === '30s'} 
                        onClick={() => generateSummary('30s')} 
                      />
                      <SummaryDepthButton 
                        title="The highlights" 
                        time="1 min read" 
                        lines={[12, 16, 10]} 
                        selected={summaryTime === '1m'} 
                        onClick={() => generateSummary('1m')} 
                      />
                      <SummaryDepthButton 
                        title="Deep dive" 
                        time="3 min read" 
                        lines={[14, 16, 12, 16, 10]} 
                        selected={summaryTime === '3m'} 
                        onClick={() => generateSummary('3m')} 
                      />
                    </div>
                  </div>
                  
                  {!summary && !loadingSummary ? (
                    <div className="flex flex-col items-center justify-center flex-1 text-ink-muted font-sans space-y-4">
                      <Sparkles className="w-12 h-12 text-ink-border" />
                      <p>Select a summary length above to begin.</p>
                    </div>
                  ) : loadingSummary ? (
                    <div className="flex flex-col items-center justify-center flex-1 text-ink-muted font-sans">
                      <Loader2 className="w-8 h-8 animate-spin mb-4 text-citrus-mid" />
                      <p>Reading and summarizing...</p>
                    </div>
                  ) : (
                    <div className="prose prose-lg max-w-none text-ink-text prose-headings:text-ink-text prose-a:text-ink-text hover:prose-a:bg-citrus-light hover:prose-a:text-citrus-hover-text prose-strong:text-ink-text">
                      <Markdown>{summary}</Markdown>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col h-full">
                  <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {chatHistory.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-ink-muted font-sans">
                        <MessageCircleQuestion className="w-12 h-12 text-ink-border mb-4" />
                        <p>Ask any question about the article.</p>
                        <p className="text-sm text-ink-muted mt-2">e.g., "What is evaporative cooling?"</p>
                      </div>
                    ) : (
                      chatHistory.map((msg, idx) => (
                        <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] rounded-2xl px-5 py-3 font-sans text-sm ${
                            msg.role === 'user' 
                              ? 'bg-ink-text text-ink-surface rounded-tr-sm' 
                              : 'bg-ink-surface border border-ink-border text-ink-text rounded-tl-sm shadow-sm'
                          }`}>
                            <div className="prose prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-ink-border prose-pre:text-ink-text prose-strong:text-inherit">
                              <Markdown>
                                {msg.text}
                              </Markdown>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                    {isChatting && (
                      <div className="flex justify-start">
                        <div className="bg-ink-surface border border-ink-border rounded-2xl rounded-tl-sm px-5 py-4 shadow-sm">
                          <Loader2 className="w-4 h-4 animate-spin text-ink-muted" />
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="p-4 bg-ink-bg border-t border-ink-border">
                    <form onSubmit={handleAskQuestion} className="relative flex items-center">
                      <input
                        type="text"
                        value={currentQuestion}
                        onChange={(e) => setCurrentQuestion(e.target.value)}
                        placeholder="Ask about the article..."
                        className="w-full bg-ink-surface border border-ink-border focus:bg-ink-bg focus:border-citrus-mid focus:ring-2 focus:ring-citrus-light rounded-xl py-3 pl-4 pr-12 font-sans text-sm transition-all outline-none text-ink-text placeholder:text-ink-muted"
                        disabled={isChatting}
                      />
                      <button
                        type="submit"
                        disabled={isChatting || !currentQuestion.trim()}
                        className="absolute right-2 p-2 text-ink-muted hover:text-citrus-hover-text disabled:opacity-50 transition-colors"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
