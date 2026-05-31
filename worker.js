export default {
    async fetch(request, env) {
        if (request.method === "OPTIONS") {
            return new Response(null, {
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "POST, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type",
                }
            });
        }

        if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

        try {
            const data = await request.json();
            const API_KEY = env.GEMINI_API_KEY; 

            if (data.ping) {
                try {
                    const checkUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;
                    const pingCheck = await fetch(checkUrl);
                    
                    return new Response(JSON.stringify({
                        worker: "ok",
                        gemini: pingCheck.ok ? "ok" : "error"
                    }), {
                        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
                    });
                } catch(e) {
                    return new Response(JSON.stringify({ worker: "ok", gemini: "error" }), {
                        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
                    });
                }
            }
            
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${API_KEY}`;
            
            const prompt = `
            Jesteś zaawansowanym asystentem inżynieryjnym wspierającym zarządzanie produkcją w firmie DIEHL Controls. Wygeneruj profesjonalny, krótki raport CAPA w JĘZYKU POLSKIM skupiony wokół analizy wąskich gardeł na liniach montażu powierzchniowego (SMT). Skoncentruj się wyłączenie na defektach fizycznych (błędy PnP, wady pieca lutowniczego, przesunięcia komponentów).
            Zwróć 2-3 techniczne akcje prewencyjne ubrane w punktory. Formatowanie wyjściowe to sam kod HTML, gotowy do wrzucenia na stronę (np. tagi <b>, <ul>, <br>). Nie twórz kontenerów markdown.
            `;

            const googleResponse = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });

            if (!googleResponse.ok) throw new Error("Google API Error");

            const result = await googleResponse.json();
            let rawHtml = result.candidates[0].content.parts[0].text;
            rawHtml = rawHtml.replace(/```html/g, "").replace(/```/g, "");

            return new Response(rawHtml, {
                headers: { 
                    "Content-Type": "text/html; charset=utf-8", 
                    "Access-Control-Allow-Origin": "*" 
                }
            });

        } catch (error) {
            return new Response(`<b>Wewnętrzny Błąd Serwera API:</b> ${error.message}`, { 
                status: 500, headers: { "Access-Control-Allow-Origin": "*" } 
            });
        }
    }
};
