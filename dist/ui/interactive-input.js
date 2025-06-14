import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { useInput } from 'ink';
// Shared input component using Ink
export const InteractiveInput = ({
  question,
  questionId,
  predefinedOptions,
  onSubmit,
}) => {
  const [mode, setMode] = useState('option');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [customValue, setCustomValue] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  // Get the character under cursor, if any
  const charUnderCursor = customValue[cursorPosition] || null;
  // If there are no predefined options, default to custom input mode
  useEffect(() => {
    if (!predefinedOptions || predefinedOptions.length === 0) {
      setMode('custom');
    } else {
      // Ensure mode is 'option' if options become available
      setMode('option');
      setSelectedIndex(0); // Reset selection
    }
  }, [predefinedOptions]);
  // Capture key presses
  useInput((input, key) => {
    if ((key.upArrow || key.downArrow) && predefinedOptions?.length) {
      // cycle selection among predefined options
      setSelectedIndex((prev) => {
        if (key.upArrow) {
          return prev > 0 ? prev - 1 : predefinedOptions.length - 1;
        } else {
          return prev < predefinedOptions.length - 1 ? prev + 1 : 0;
        }
      });
      setMode('option');
    } else if (key.leftArrow) {
      if (mode === 'custom') {
        // Move cursor left if possible
        setCursorPosition((prev) => Math.max(0, prev - 1));
      } else {
        // If in option mode, just switch to custom mode but keep cursor at 0
        setMode('custom');
        setCursorPosition(0);
      }
    } else if (key.rightArrow) {
      if (mode === 'custom') {
        // Move cursor right if possible
        setCursorPosition((prev) => Math.min(customValue.length, prev + 1));
      } else {
        // If in option mode, switch to custom mode with cursor at end of text
        setMode('custom');
        setCursorPosition(customValue.length);
      }
    } else if (key.return) {
      const value =
        mode === 'custom'
          ? customValue
          : (predefinedOptions && predefinedOptions[selectedIndex]) || '';
      onSubmit(value, questionId); // Pass questionId back if it exists
    } else if (key.backspace || key.delete) {
      if (mode === 'custom') {
        if (key.delete && cursorPosition < customValue.length) {
          // Delete: remove character at cursor position
          setCustomValue(
            (prev) =>
              prev.slice(0, cursorPosition) + prev.slice(cursorPosition + 1),
          );
        } else if (key.backspace && cursorPosition > 0) {
          // Backspace: remove character before cursor and move cursor left
          setCustomValue(
            (prev) =>
              prev.slice(0, cursorPosition - 1) + prev.slice(cursorPosition),
          );
          setCursorPosition((prev) => prev - 1);
        }
      }
    } else if (input && input.length === 1 && !key.ctrl && !key.meta) {
      // Any other non-modifier key appends to custom input
      setMode('custom');
      // Insert at cursor position instead of appending
      setCustomValue(
        (prev) =>
          prev.slice(0, cursorPosition) + input + prev.slice(cursorPosition),
      );
      setCursorPosition((prev) => prev + 1);
    }
  });
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      Box,
      { flexDirection: 'column', marginBottom: 1 },
      React.createElement(
        Text,
        { bold: true, color: 'cyan', wrap: 'wrap' },
        question,
      ),
    ),
    predefinedOptions &&
      predefinedOptions.length > 0 &&
      React.createElement(
        Box,
        { flexDirection: 'column', marginBottom: 1 },
        React.createElement(
          Text,
          null,
          'Use \u2191/\u2193 to select options, type any key for custom input, Enter to submit',
        ),
        predefinedOptions.map((opt, i) =>
          React.createElement(
            Text,
            {
              key: i,
              color:
                i === selectedIndex
                  ? mode === 'option'
                    ? 'greenBright'
                    : 'green'
                  : undefined,
            },
            i === selectedIndex ? (mode === 'option' ? '› ' : '  ') : '  ',
            opt,
          ),
        ),
      ),
    React.createElement(
      Box,
      { marginBottom: 1 },
      React.createElement(
        Box,
        null,
        React.createElement(
          Text,
          {
            color:
              customValue.length > 0 || mode === 'custom'
                ? mode === 'custom'
                  ? 'greenBright'
                  : 'green'
                : undefined,
          },
          customValue.length > 0 && mode === 'custom' ? '✎ ' : '  ',
          predefinedOptions && predefinedOptions.length > 0 ? 'Custom: ' : '',
          customValue.slice(0, cursorPosition),
        ),
        charUnderCursor
          ? React.createElement(
              Text,
              { backgroundColor: 'green', color: 'black' },
              charUnderCursor,
            )
          : // Display block cursor only in custom mode or when options are present (to show where custom input would go)
            (mode === 'custom' ||
              (predefinedOptions && predefinedOptions.length > 0)) &&
              React.createElement(
                Text,
                { color: mode === 'custom' ? 'green' : undefined },
                '\u2588',
              ),
        React.createElement(
          Text,
          {
            color:
              customValue.length > 0 || mode === 'custom'
                ? mode === 'custom'
                  ? 'greenBright'
                  : 'green'
                : undefined,
          },
          customValue.slice(cursorPosition + 1),
        ),
      ),
    ),
  );
};
