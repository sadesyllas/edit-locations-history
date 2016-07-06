'use strict';

import * as vscode from 'vscode';

interface ILocation {
	file: string;
	line: number;
	character: number;
}

let editLocationsHistory = <ILocation[]>[];
const maxLocationsDefault = 1000;
let currentIndex = maxLocationsDefault - 1;
let activeEditorChangeCallback: Function;

function getPreviousEditLocation() {
	currentIndex = Math.max(Math.min(currentIndex, editLocationsHistory.length - 1) - 1, 0);
	return editLocationsHistory[currentIndex];
}

function getNextEditLocation() {
	currentIndex = Math.min(currentIndex + 1, editLocationsHistory.length - 1);
	return editLocationsHistory[currentIndex];
}

function revealEditLocation(locationGetter: () => ILocation): void {
	if (typeof(locationGetter) !== 'function') {
		return;
	}

	const location = locationGetter();

	if (!location) {
		return;
	}

	function _revealEditLocation(editor: vscode.TextEditor) {
		if (!editor) {
			return;
		}
		editor.selection = new vscode.Selection(location.line, location.character, location.line, location.character);
		editor.revealRange(new vscode.Range(location.line, location.character, location.line, location.character));
	}

	let activeEditor = vscode.window.activeTextEditor;
	if (activeEditor && activeEditor.document.fileName === location.file) {
		_revealEditLocation(activeEditor);
	} else {
		vscode.workspace.openTextDocument(location.file)
			.then(vscode.window.showTextDocument, error => {
				// this is an untitled editor so we must find it manually
				if (/file:\/\/\/untitled-[0-9]+/i.test(error)) {
					function _nextEditor() {
						return vscode.commands.executeCommand('workbench.action.nextEditor');
					}
					const currentFileName = vscode.window.activeTextEditor.document.fileName;
					activeEditorChangeCallback = e => {
						// we have found the correct text editor so we will proceed to the edit location 
						if (e.document.fileName === location.file) {
							activeEditorChangeCallback = null;
							_revealEditLocation(e);
							return;
						}
						// we have made a complete cycle and did not find the correct editor so we filter it out and continue
						if (e.document.fileName === currentFileName) {
							activeEditorChangeCallback = null;
							editLocationsHistory = editLocationsHistory.filter(h => h.file !== location.file);
							return;
						}
						// we continue searching for the correct editor
						_nextEditor();
					};
					_nextEditor();
					return;
				}
				editLocationsHistory = editLocationsHistory.filter(h => h.file !== location.file || h.line !== location.line || h.character !== location.character);
				revealEditLocation(locationGetter);
			})
			.then(_revealEditLocation);
	}
}

export function activate(context: vscode.ExtensionContext) {
	const activeEditorChangeListener = vscode.window.onDidChangeActiveTextEditor(e => {
		if (typeof(activeEditorChangeCallback) === 'function') {
			activeEditorChangeCallback(e);
		}
	});

	const textDocumentChangeListener = vscode.workspace.onDidChangeTextDocument(e => {
		function filterEmptyLines(doc: vscode.TextDocument) {
			editLocationsHistory = editLocationsHistory.filter(h => h.file !== doc.fileName || !doc.lineAt(h.line).isEmptyOrWhitespace);
		}

		const change = e.contentChanges[e.contentChanges.length - 1];

		if (!change) {
			return;
		}

		const start = change.range.start;
		const end = change.range.end;
		const lastLocation = editLocationsHistory[editLocationsHistory.length - 1];
		const character = start.character + change.text.length;

		// we removed text so we must adjust the entries after the point of text removal
		if (change.text === '') {
			editLocationsHistory.filter(h => h.file === e.document.fileName && h.line >= end.line).forEach(h => {
				h.line -= (end.line - start.line);
			});
			filterEmptyLines(e.document);
			return;
		}

		// we inserted a new line so we must adjust the entries after the new line
		if (/^[\r\n]*$/.test(change.text)) {
			editLocationsHistory.filter(h => h.file === e.document.fileName && h.line > start.line).forEach(h => {
				h.line++;
			});
			filterEmptyLines(e.document);
			return;
		}

		if (!lastLocation || lastLocation.file !== e.document.fileName || lastLocation.line !== start.line) {
			// insert the new edit location and ensure its line has only one entry in the history
			editLocationsHistory = editLocationsHistory.filter(h => h.file !== e.document.fileName || h.line !== start.line).concat([ {
				file: e.document.fileName,
				line: start.line,
				character: character,
			} ]);
			// reset the index
			currentIndex = maxLocationsDefault - 1;
			// filter out history entries that have an inexistent line number in the active document
			editLocationsHistory = editLocationsHistory.filter(h => h.file !== e.document.fileName || h.line <= e.document.lineCount);
		} else {
			lastLocation.character = character;
		}

		let maxLocations = Math.max(vscode.workspace.getConfiguration('editLocationsHistory').get('maxLocations', maxLocationsDefault), 2);

		if (isNaN(maxLocations)) {
			maxLocations = maxLocationsDefault;
		}
		if (editLocationsHistory.length > maxLocations) {
			editLocationsHistory = editLocationsHistory.slice(editLocationsHistory.length - maxLocations);
		}
	});

	const commandPreviousEditLocation = vscode.commands.registerCommand('extension.gotoPreviousEditLocation', () => {
		revealEditLocation(() => getPreviousEditLocation());
	});

	const commandNextEditLocation = vscode.commands.registerCommand('extension.gotoNextEditLocation', () => {
		revealEditLocation(() => getNextEditLocation());
	});

	const commandClearEditLocations = vscode.commands.registerCommand('extension.clearEditLocationsHistory', () => {
		editLocationsHistory = [];
	});

	context.subscriptions.push(activeEditorChangeListener, textDocumentChangeListener, commandPreviousEditLocation, commandNextEditLocation, commandClearEditLocations);
}
