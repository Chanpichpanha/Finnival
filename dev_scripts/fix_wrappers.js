const fs = require("fs");
let content = fs.readFileSync("client/src/components/MatchGame.js", "utf8");

// We need to wrap the left buttons in a div with the ref and touchAction: none
const leftButtonRegex = /<button\s+key=\{\`left-\$\{i\}\`\}\s+ref=\{el => leftRefs\.current\[i\] = el\}\s+className=\{([^}]+)\}\s+onPointerDown=\{\(e\) => handlePointerDown\(e, i\)\}\s+onDragStart=\{\(e\) => e\.preventDefault\(\)\}\s+draggable=\{false\}\s+onClick=\{\(\) => \{([\s\S]*?)\}\}\s+disabled=\{([^\}]+)\}\s+style=\{\{([\s\S]*?)\}\}\s*>\s*\{p\.left\}\s*<\/button>/;

content = content.replace(leftButtonRegex, (match, className, onClickBody, disabled, style) => {
    return `<div key={\`left-\${i}\`} ref={el => leftRefs.current[i] = el} style={{ display: 'flex', touchAction: 'none' }}>
                            <button 
                                className={${className}}
                                onPointerDown={(e) => handlePointerDown(e, i)}
                                onDragStart={(e) => e.preventDefault()}
                                draggable={false}
                                onClick={() => {${onClickBody}}}
                                disabled={${disabled}}
                                style={{${style}, width: '100%', touchAction: 'none'}}
                            >
                                {p.left}
                            </button>
                        </div>`;
});

// We should also do the same for the right buttons just in case!
const rightButtonRegex = /<button\s+key=\{\`right-\$\{realIndex\}\`\}\s+ref=\{el => rightRefs\.current\[realIndex\] = el\}\s+className=\{([^}]+)\}\s+data-index=\{realIndex\}\s+onClick=\{\(\) => handleRightClick\(realIndex\)\}\s+onDragStart=\{\(e\) => e\.preventDefault\(\)\}\s+draggable=\{false\}\s+disabled=\{([^\}]+)\}\s+style=\{\{([\s\S]*?)\}\}\s*>\s*\{p\.right\}\s*<\/button>/;

content = content.replace(rightButtonRegex, (match, className, disabled, style) => {
    return `<div key={\`right-\${realIndex}\`} ref={el => rightRefs.current[realIndex] = el} style={{ display: 'flex', touchAction: 'none' }}>
                            <button 
                                className={${className}}
                                data-index={realIndex}
                                onClick={() => handleRightClick(realIndex)}
                                onDragStart={(e) => e.preventDefault()}
                                draggable={false}
                                disabled={${disabled}}
                                style={{${style}, width: '100%', touchAction: 'none'}}
                            >
                                {p.right}
                            </button>
                        </div>`;
});

fs.writeFileSync("client/src/components/MatchGame.js", content);
console.log("Wrapped buttons in stable divs.");
