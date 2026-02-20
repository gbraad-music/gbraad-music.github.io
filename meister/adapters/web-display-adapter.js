/**
 * Web Display Adapter
 * Renders DisplayMessages to HTML/DOM elements in the browser
 */

class WebDisplayAdapter {
    constructor(elementIdOrElement) {
        // Support both element ID (string) and direct element reference
        if (typeof elementIdOrElement === 'string') {
            this.elementId = elementIdOrElement;
            this.element = document.getElementById(elementIdOrElement);
        } else {
            // Direct element reference (for shadow DOM elements)
            this.element = elementIdOrElement;
            this.elementId = elementIdOrElement.id || 'direct-element';
        }
        this.lines = [];

        // Note: Element may be in shadow DOM and not found initially - will be queried on first message
        if (this.element) {
            // console.log(`[WebDisplay] Initialized for element: ${this.elementId}`);
        }
    }

    /**
     * Send DisplayMessage to web element
     * @param {Object} message - DisplayMessage object
     */
    sendMessage(message) {
        // Re-query element if needed
        if (!this.element) {
            this.element = document.getElementById(this.elementId);
            if (!this.element) {
                console.warn(`[WebDisplay] Element still not found: ${this.elementId}`);
                return;
            }
        }

        // Clear element
        this.element.innerHTML = '';

        // Store lines
        this.lines = message.lines;

        // Render lines
        message.lines.forEach((line, idx) => {
            const lineDiv = document.createElement('div');
            lineDiv.style.fontFamily = 'Arial, sans-serif';
            lineDiv.style.fontSize = '14px';
            lineDiv.style.whiteSpace = 'pre';
            lineDiv.style.lineHeight = '1.5';
            lineDiv.style.height = '21px';  // Fixed height to prevent wobble
            lineDiv.style.display = 'block';
            lineDiv.style.overflow = 'hidden';

            // Check for PFL, LOOP, and MUTE indicators to color them
            if (idx === 0 && (line.includes('PFL') || line.includes('LOOP') || (message.metadata?.mute && line.includes(' M ')))) {
                // Color PFL green, LOOP yellow, and M red
                let coloredLine = line;

                // Replace LOOP with yellow
                if (line.includes('LOOP')) {
                    coloredLine = coloredLine.replace('LOOP', '<span style="color: #FFFF00; font-weight: bold;">LOOP</span>');
                }

                // Replace PFL with green
                if (line.includes('PFL')) {
                    coloredLine = coloredLine.replace('PFL', '<span style="color: #00ff00; font-weight: bold;">PFL</span>');
                }

                // Replace M with red (check for mute in metadata)
                if (message.metadata?.mute && line.includes(' M ')) {
                    coloredLine = coloredLine.replace(' M ', ' <span style="color: #FF0000; font-weight: bold;">M</span> ');
                }

                // Wrap rest in default color
                lineDiv.innerHTML = `<span style="color: #4a9eff">${coloredLine}</span>`;
            } else if (message.metadata?.fx && idx === 3 && line.includes('FX:')) {
                // Render FX indicators as green highlighted boxes
                const fxMatch = line.match(/FX:([1-4]+)/);
                if (fxMatch) {
                    const before = line.substring(0, line.indexOf('FX:'));
                    const fxNumbers = fxMatch[1].split('');

                    let fxHtml = `<span style="color: #4a9eff">${before}</span>`;
                    fxNumbers.forEach((num, i) => {
                        const bgColor = message.metadata.fxColors?.[num] || '#00FF00';
                        fxHtml += `<span style="display: inline-block; background: ${bgColor}; color: #000; font-weight: bold; padding: 2px 6px; margin: 0 3px; border-radius: 3px; font-size: 11px; line-height: 1;">FX${num}</span>`;
                    });

                    lineDiv.innerHTML = fxHtml;
                } else {
                    lineDiv.textContent = line;
                }
            } else {
                lineDiv.textContent = line;
            }

            // Apply category styling
            if (message.metadata?.category === 'status') {
                lineDiv.style.color = '#4a9eff';
            } else if (message.metadata?.category === 'notification') {
                lineDiv.style.color = '#ffcc00';
                lineDiv.style.fontWeight = 'bold';
            } else if (message.metadata?.category === 'error') {
                lineDiv.style.color = '#ff4444';
                lineDiv.style.fontWeight = 'bold';
            } else {
                lineDiv.style.color = '#d0d0d0';
            }

            this.element.appendChild(lineDiv);
        });

        // Render graphics primitives
        if (message.graphics) {
            message.graphics.forEach(gfx => {
                this.renderGraphicHTML(gfx);
            });
        }

        // Auto-dismiss if duration set
        if (message.metadata?.duration) {
            setTimeout(() => {
                this.clear();
            }, message.metadata.duration);
        }
    }

    /**
     * Render graphic primitive as HTML
     */
    renderGraphicHTML(gfx) {
        if (gfx.type === 'bar') {
            const barDiv = document.createElement('div');
            barDiv.style.width = `${gfx.width * 10}px`;
            barDiv.style.height = '8px';
            barDiv.style.border = '1px solid #4a9eff';
            barDiv.style.position = 'relative';
            barDiv.style.marginTop = '4px';
            barDiv.style.marginLeft = `${gfx.col * 10}px`;

            const fillDiv = document.createElement('div');
            fillDiv.style.width = `${gfx.value * 100}%`;
            fillDiv.style.height = '100%';
            fillDiv.style.background = '#4a9eff';

            barDiv.appendChild(fillDiv);
            this.element.appendChild(barDiv);
        }
    }

    /**
     * Clear display
     */
    clear() {
        if (this.element) {
            this.element.innerHTML = '';
            this.lines = [];
        }
    }

    /**
     * Get current lines
     */
    getLines() {
        return [...this.lines];
    }
}

// Make available globally
window.WebDisplayAdapter = WebDisplayAdapter;
