#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#import <OpenGL/gl.h>
#include "glw_internal.h"

@interface GLView : NSOpenGLView <NSWindowDelegate> {
  CVDisplayLinkRef displayLink;
@public
  void (*onReshape)(glwWin *win, int width, int height);
  void (*onDisplay)(glwWin *win);
  void (*onMouse)(glwWin *win, int button, int state, int x, int y);
  void (*onMotion)(glwWin *win, int x, int y);
  void (*onPassiveMotion)(glwWin *win, int x, int y);
  void *userData;
  int pendingReshape;
  int viewWidth;
  int viewHeight;
  float scaleX;
  float scaleY;
  glwSystemFontTexture systemFontTexture;
  glwImGui imGUI;
}

- (CVReturn)getFrameForTime:(const CVTimeStamp *)outputTime;
- (void)drawFrame;
@end

static CVReturn onDisplayLinkCallback(CVDisplayLinkRef displayLink, 
    const CVTimeStamp *now, const CVTimeStamp *outputTime, 
    CVOptionFlags flagsIn, CVOptionFlags *flagsOut, void *displayLinkContext)
{
  CVReturn result = [(GLView *)displayLinkContext getFrameForTime:outputTime];
  return result;
}

glwSystemFontTexture *glwGetSystemFontTexture(glwWin *win) {
  GLView *view = ((NSWindow *)win).contentView;
  return &view->systemFontTexture;
}

@implementation GLView
- (id)initWithFrame:(NSRect)frameRect {
  NSOpenGLPixelFormatAttribute attribs[] = {NSOpenGLPFAMultisample,
		NSOpenGLPFASampleBuffers, 1,
		NSOpenGLPFASamples, 0,
		NSOpenGLPFAAccelerated,
		NSOpenGLPFADoubleBuffer,
		NSOpenGLPFAColorSize, 32,
		NSOpenGLPFADepthSize, 24,
		NSOpenGLPFAAlphaSize, 8,
		NSOpenGLPFAOpenGLProfile, NSOpenGLProfileVersionLegacy,
		0};
  NSOpenGLPixelFormat *windowedPixelFormat = [[NSOpenGLPixelFormat alloc] 
    initWithAttributes:attribs];
  self = [super initWithFrame:frameRect pixelFormat:windowedPixelFormat];
  [windowedPixelFormat release];
  
  [self setWantsBestResolutionOpenGLSurface:YES];
  
  return self;
}

- (void) prepareOpenGL {
	[super prepareOpenGL];

  GLint vblSynch = 1;
  [[self openGLContext] setValues:&vblSynch 
    forParameter:NSOpenGLCPSwapInterval];

  CVDisplayLinkCreateWithActiveCGDisplays(&displayLink);
  CVDisplayLinkSetOutputCallback(displayLink, onDisplayLinkCallback, self);
  CVDisplayLinkSetCurrentCGDisplayFromOpenGLContext(displayLink, 
    [[self openGLContext] CGLContextObj], 
    [[self pixelFormat] CGLPixelFormatObj]);
  
  CVDisplayLinkStart(displayLink);
}

- (void)drawFrame {
  @autoreleasepool {
    NSOpenGLContext *currentContext = [self openGLContext];
    [currentContext makeCurrentContext];
    CGLLockContext([currentContext CGLContextObj]);
    if (self->pendingReshape) {
      if (self->onReshape) {
        self->pendingReshape = 0;
        if (!self->systemFontTexture.texId) {
          glwInitSystemFontTexture((glwWin *)self.window);
        }
        self->onReshape((glwWin *)self.window, self->viewWidth,
          self->viewHeight);
      }
    }
    if (self->onDisplay) {
      self->onDisplay((glwWin *)self.window);
    }
    CGLFlushDrawable([[self openGLContext] CGLContextObj]);
    CGLUnlockContext([currentContext CGLContextObj]);
  }
}

- (CVReturn)getFrameForTime:(const CVTimeStamp *)outputTime {
  [self drawFrame];
  return kCVReturnSuccess;
}

- (void)dealloc {
  CVDisplayLinkRelease(displayLink);
  [super dealloc];
}

- (BOOL)acceptsFirstResponder {
  return YES;
}

- (void)reshape {
  NSRect bounds = [self bounds];
  NSRect backingBounds = [self convertRectToBacking:[self bounds]];
  viewWidth = (int)backingBounds.size.width;
  viewHeight = (int)backingBounds.size.height;
  self->scaleX = (float)viewWidth / bounds.size.width;
  self->scaleY = (float)viewHeight / bounds.size.height;
  self->pendingReshape = 1;
  [self drawFrame];
}

- (void)resumeDisplayRenderer  {
  NSOpenGLContext *currentContext = [self openGLContext];
  [currentContext makeCurrentContext];
  CGLLockContext([currentContext CGLContextObj]);
  CVDisplayLinkStart(displayLink);
  CGLUnlockContext([currentContext CGLContextObj]);
}

- (void)haltDisplayRenderer  {
  NSOpenGLContext *currentContext = [self openGLContext];
  [currentContext makeCurrentContext];
  CGLLockContext([currentContext CGLContextObj]);
  CVDisplayLinkStop(displayLink);
  CGLUnlockContext([currentContext CGLContextObj]);
}

- (void)mouseMoved:(NSEvent*)event {
  NSPoint loc = [self convertPoint:[event locationInWindow] fromView:nil];
  int x = loc.x * self->scaleX;
  int y = loc.y * self->scaleY;
  if (GLW_DOWN == self->imGUI.mouseState) {
    if (self->onMotion) {
      self->onMotion((glwWin *)self.window, x, y);
    }
  } else {
    if (self->onPassiveMotion) {
      self->onPassiveMotion((glwWin *)self.window, x, y);
    }
  }
}

- (void)mouseDown:(NSEvent*)event {
  NSPoint loc = [self convertPoint:[event locationInWindow] fromView:nil];
  int x = loc.x * self->scaleX;
  int y = loc.y * self->scaleY;
  glwMouseEvent((glwWin *)self.window, GLW_LEFT_BUTTON, GLW_DOWN, x, y);
  if (self->onMouse) {
    self->onMouse((glwWin *)self.window, GLW_LEFT_BUTTON, GLW_DOWN, x, y);
  }
}

- (void)mouseDragged:(NSEvent *)event {
  NSPoint loc = [self convertPoint:[event locationInWindow] fromView:nil];
  int x = loc.x * self->scaleX;
  int y = loc.y * self->scaleY;
  if (GLW_DOWN == self->imGUI.mouseState) {
    if (GLW_DOWN == self->imGUI.mouseState) {
      if (self->onMotion) {
        self->onMotion((glwWin *)self.window, x, y);
      }
    } else {
      if (self->onPassiveMotion) {
        self->onPassiveMotion((glwWin *)self.window, x, y);
      }
    }
  } else {
    glwMouseEvent((glwWin *)self.window, GLW_LEFT_BUTTON, GLW_DOWN, x, y);
    if (self->onMouse) {
      self->onMouse((glwWin *)self.window, GLW_LEFT_BUTTON, GLW_DOWN, x, y);
    }
  }
}

- (BOOL)isFlipped {
  return YES;
}

- (void)mouseUp:(NSEvent*)event {
  NSPoint loc = [self convertPoint:[event locationInWindow] fromView:nil];
  int x = loc.x * self->scaleX;
  int y = loc.y * self->scaleY;
  glwMouseEvent((glwWin *)self.window, GLW_LEFT_BUTTON, GLW_UP, x, y);
  if (self->onMouse) {
    self->onMouse((glwWin *)self.window, GLW_LEFT_BUTTON, GLW_UP, x, y);
  }
}
@end

glwImGui *glwGetImGUI(glwWin *win) {
  GLView *view = ((NSWindow *)win).contentView;
  return &view->imGUI;
}

glwFont *glwCreateFont(char *name, int weight, int size, int bold) {
  NSString *fontFamily = [NSString stringWithCString:name 
    encoding:NSMacOSRomanStringEncoding];
  NSFont *font = [[[NSFontManager sharedFontManager] fontWithFamily:fontFamily 
    traits:(bold ? NSBoldFontMask : NSUnboldFontMask) weight:weight size:size] retain];
  return (glwFont *)font;
}

glwSize glwMeasureText(char *text, glwFont *font) {
  NSString *aString = [NSString stringWithCString:text 
    encoding:NSMacOSRomanStringEncoding];
  NSSize frameSize = [aString sizeWithAttributes:
    [NSDictionary dictionaryWithObject:(NSFont *)font forKey:NSFontAttributeName]];
  glwSize size = {frameSize.width, frameSize.height};
  return size;
}

void glwInit(void) {
  [NSApplication sharedApplication];
  glwInitPrimitives();
}

void glwMainLoop(void) {
  @autoreleasepool {
    [NSApp run];
  }
}

void glwSetUserData(glwWin *win, void *userData) {
  GLView *view = ((NSWindow *)win).contentView;
  view->userData = userData;
}

void *glwGetUserData(glwWin *win) {
  GLView *view = ((NSWindow *)win).contentView;
  return view->userData;
}

glwWin *glwCreateWindow(int x, int y, int width, int height) {
  NSUInteger windowStyle = NSTitledWindowMask | NSClosableWindowMask | 
    NSResizableWindowMask | NSMiniaturizableWindowMask;
  NSRect fullRect = [[NSScreen mainScreen] visibleFrame];
  
  if (0 == width || 0 == height) {
    width = fullRect.size.width;
    height = fullRect.size.height;
  }
  
  NSRect viewRect = NSMakeRect(0, 0, width, height);
  NSRect windowRect = NSMakeRect(x, y, width, height);
  
  NSWindow *window = [[NSWindow alloc] initWithContentRect:windowRect 
    styleMask:windowStyle
    backing:NSBackingStoreBuffered 
    defer:NO];
  
  GLView *view = [[GLView alloc] initWithFrame:viewRect];
  view->onReshape = 0;
  view->onDisplay = 0;
  view->onMouse = 0;
  view->userData = 0;
  view->pendingReshape = 0;
  view->viewWidth = width;
  view->viewHeight = height;
  view->systemFontTexture.texId = 0;
  memset(&view->imGUI, 0, sizeof(view->imGUI));
  view->scaleX = 1;
  view->scaleY = 1;
  view->onPassiveMotion = 0;
  view->onMotion = 0;
  
  [window setAcceptsMouseMovedEvents:YES];
  [window setContentView:view];
  [window setDelegate:view];
  
  [window orderFrontRegardless];
  
  return (glwWin *)window;
}

void glwDisplayFunc(glwWin *win, void (*func)(glwWin *win)) {
  GLView *view = ((NSWindow *)win).contentView;
  view->onDisplay = func;
}

void glwReshapeFunc(glwWin *win, void (*func)(glwWin *win, int width,
    int height)) {
  GLView *view = ((NSWindow *)win).contentView;
  view->onReshape = func;
}

void glwMouseFunc(glwWin *win, void (*func)(glwWin *win, int button, int state,
    int x, int y)) {
  GLView *view = ((NSWindow *)win).contentView;
  view->onMouse = func;
}

void glwMotionFunc(glwWin *win,
    void (*func)(glwWin *win, int x, int y)) {
  GLView *view = ((NSWindow *)win).contentView;
  view->onMotion = func;
}

void glwPassiveMotionFunc(glwWin *win,
    void (*func)(glwWin *win, int x, int y)) {
  GLView *view = ((NSWindow *)win).contentView;
  view->onPassiveMotion = func;
}

unsigned char *glwRenderTextToRGBA(char *text, glwFont *font, glwSize size,
    int *pixelsWide, int *pixelsHigh) {
  NSString *aString = [NSString stringWithCString:text encoding:NSMacOSRomanStringEncoding];
  NSSize frameSize = NSMakeSize(size.width, size.height);
  NSImage *image = [[NSImage alloc] initWithSize:frameSize];
  unsigned char *rgba = 0;
  int rgbaBytes = 0;
  [image lockFocus];
  [aString drawAtPoint:NSMakePoint(0, 0) withAttributes:
    [NSDictionary dictionaryWithObject:(NSFont *)font forKey:NSFontAttributeName]];
  [image unlockFocus];
  NSBitmapImageRep *bitmap = [NSBitmapImageRep imageRepWithData:[image TIFFRepresentation]];
  *pixelsWide = [bitmap pixelsWide];
  *pixelsHigh = [bitmap pixelsHigh];
  rgbaBytes = 4 * (*pixelsWide) * (*pixelsHigh);
  rgba = malloc(rgbaBytes);
  memcpy(rgba, [bitmap bitmapData], rgbaBytes);
  [image release];
  return rgba;
}

void glwDestroyFont(glwFont *font) {
  NSFont *nsFont = (NSFont *)font;
  [nsFont release];
}


