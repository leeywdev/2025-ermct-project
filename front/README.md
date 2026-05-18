
  # Emergency Transport System

  This is a code bundle for Emergency Transport System. The original project is available at https://www.figma.com/design/UxuDvlI7vRaGWhmNZSgwuB/Emergency-Transport-System.

  ## Running the code

  Run `npm i` to install the dependencies.

  Create `front/.env` before starting the dev server. In Vite, client-side environment variables must use the `VITE_` prefix.

  Example:
  ```env
  VITE_API_BASE_URL=http://127.0.0.1:8000
  VITE_TMAP_API_KEY=your_tmap_key
  VITE_KAKAO_MAP_KEY=your_kakao_js_key
  ```

  If you change `.env`, restart the Vite dev server so the new values are loaded.

  Run `npm run dev` to start the development server.
  
