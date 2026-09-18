# Snake Game

Minimal classic Snake implementation using plain HTML/CSS/JS.

## Run locally

```bash
python3 -m http.server 8000
```

Then open: `http://localhost:8000`

## Manual verification checklist

- Movement works with arrow keys and WASD.
- On-screen buttons (Up/Down/Left/Right) move the snake.
- Snake grows by one segment after eating food.
- Score increments by 1 per food.
- Snake wraps from one wall to the opposite wall.
- Game ends on self collision.
- Pause/Resume works via button and Space key.
- Restart resets board, score, and state.
