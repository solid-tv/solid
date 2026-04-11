### FPS Counter Component

This component displays the current frames per second (FPS) of the application.

To use, import FPSCounter and add it to your component tree. import { setupFPS } from '@solidtv/solid'; On your canvas element add renderer option: fpsUpdateInterval: 200 and ref={(root) => setupFPS(root)}

```jsx
import { FPSCounter, setupFPS } from '@solidtv/solid/primitives';
import { renderer } from '@solidtv/solid';

//inside App component

setupFPS({ renderer });

<FPSCounter mountX={1} x={1910} y={10} />;
```
