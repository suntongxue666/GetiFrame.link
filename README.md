# iFrame Master

A professional tool for generating and extracting iFrame URLs from web pages. Built with modern web technologies and featuring an Apple-style design.

## Features

- **iFrame Extraction**: Automatically detect and extract iFrame codes from any webpage
- **iFrame Generation**: Create custom iFrame codes with configurable parameters
- **Bulk Export**: Export multiple iFrame URLs in TXT or Excel format
- **Modern UI**: Clean, responsive design with Apple-style aesthetics
- **Mobile Friendly**: Works perfectly on all devices

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/iframe-master.git
cd iframe-master
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

The application will be available at `http://localhost:3000`

## Development

To run the application in development mode with auto-reload:

```bash
npm run dev
```

## Usage

### Extracting iFrames

1. Navigate to the "With iFrame" tab
2. Enter the URL of the webpage containing iFrames
3. Click "Extract iFrames"
4. Copy individual iFrame codes or use the bulk export options

### Generating iFrames

1. Navigate to the "No iFrame" tab
2. Enter the target URL
3. Configure width, height, scrolling, and border options
4. Click "Generate iFrame"
5. Copy the generated code

## Technologies Used

- Frontend:
  - HTML5
  - CSS3 (with modern features like CSS Variables and Flexbox)
  - JavaScript (ES6+)
  - Font Awesome for icons
- Backend:
  - Node.js
  - Express.js
  - Axios for HTTP requests
  - Cheerio for HTML parsing

## License

MIT License - feel free to use this project for any purpose.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request 