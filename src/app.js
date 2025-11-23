const { ipcRenderer } = require('electron');

// Application state
let currentTabId = null;
let tabs = {};
let taskCounter = 0;
let isFocusMode = false;
let focusStartTime = null;
let focusTimerInterval = null;
let draggedTaskId = null;

// DOM elements
const tabsContainer = document.querySelector('.tabs');
const tasksContainer = document.querySelector('.tasks-container');
const newTaskInput = document.getElementById('new-task-input');
const addTaskBtn = document.getElementById('add-task-btn');
const addTabBtn = document.getElementById('add-tab-btn');

// Done section elements
const doneContainer = document.getElementById('done-container');
const doneTasksContainer = document.querySelector('.done-tasks');

// Modal elements
const tabNameModal = document.getElementById('tab-name-modal');
const modalTitle = document.getElementById('modal-title');
const tabNameInput = document.getElementById('tab-name-input');
const cancelTabBtn = document.getElementById('cancel-tab-btn');
const createTabBtn = document.getElementById('create-tab-btn');

// Track which tab is being renamed
let renamingTabId = null;

// Focus mode elements
const normalMode = document.getElementById('normal-mode');
const focusMode = document.getElementById('focus-mode');
const focusTaskName = document.getElementById('focus-task-name');
const focusTimer = document.getElementById('focus-timer');
const exitFocusBtn = document.getElementById('exit-focus-btn');

// Initialize app
function initApp() {
    // Load saved data or create default tab
    loadData();

    if (Object.keys(tabs).length === 0) {
        createNewTab('Tasks');
    }

    // Set up event listeners
    setupEventListeners();

    // Load the first tab
    switchToTab(Object.keys(tabs)[0]);
}

// Tab management
function createNewTab(name) {
    const tabId = `tab_${Date.now()}`;
    const tabName = name.trim() || 'New Tab';

    tabs[tabId] = {
        id: tabId,
        name: tabName,
        tasks: []
    };

    renderTabs();
    saveData();
    return tabId;
}

function switchToTab(tabId) {
    if (!tabs[tabId]) return;

    currentTabId = tabId;
    renderTabs();
    renderTasks();
}

function closeTab(tabId) {
    if (Object.keys(tabs).length <= 1) {
        alert('You must have at least one tab!');
        return;
    }

    const tabIndex = Object.keys(tabs).indexOf(tabId);
    delete tabs[tabId];

    // Switch to adjacent tab or first tab
    if (currentTabId === tabId) {
        const remainingTabs = Object.keys(tabs);
        currentTabId = remainingTabs[Math.max(0, Math.min(tabIndex, remainingTabs.length - 1))];
    }

    renderTabs();
    renderTasks();
    saveData();
}

function renameTab(tabId, newName) {
    if (tabs[tabId]) {
        tabs[tabId].name = newName.trim() || 'Untitled';
        renderTabs();
        saveData();
    }
}

// Task management
function addTask(text) {
    if (!text.trim() || !currentTabId) return;

    const task = {
        id: `task_${++taskCounter}`,
        text: text.trim(),
        completed: false,
        createdAt: new Date().toISOString()
    };

    tabs[currentTabId].tasks.push(task);
    renderTasks();
    saveData();
    newTaskInput.value = '';
}

function deleteTask(taskId) {
    if (!currentTabId) return;

    tabs[currentTabId].tasks = tabs[currentTabId].tasks.filter(task => task.id !== taskId);
    renderTasks();
    saveData();
}

function toggleTask(taskId) {
    console.log('=== TOGGLE TASK START ===');
    console.log('Task ID:', taskId);
    console.log('Current tab ID:', currentTabId);

    if (!currentTabId) {
        console.log('❌ No current tab ID, returning');
        return;
    }

    const currentTab = tabs[currentTabId];
    console.log('Current tab tasks:', currentTab.tasks.map(t => `${t.id}:${t.completed ? 'completed' : 'active'}`));

    const taskIndex = currentTab.tasks.findIndex(t => t.id === taskId);
    console.log('Task index found:', taskIndex);

    if (taskIndex === -1) {
        console.log('❌ Task not found, returning');
        return;
    }

    const task = currentTab.tasks[taskIndex];
    const wasCompleted = task.completed;
    console.log('Task found:', task.id, 'was completed:', wasCompleted);

    // Toggle the completion status
    task.completed = !task.completed;
    console.log('Task is now completed:', task.completed);

    // If the task was completed and is now incomplete, move it to the beginning
    if (wasCompleted && !task.completed) {
        console.log('✅ Condition met: was completed and now incomplete, moving to beginning');
        // Remove from current position
        currentTab.tasks.splice(taskIndex, 1);
        console.log('After splice:', currentTab.tasks.map(t => `${t.id}:${t.completed ? 'completed' : 'active'}`));
        // Insert at the beginning
        currentTab.tasks.unshift(task);
        console.log('After unshift:', currentTab.tasks.map(t => `${t.id}:${t.completed ? 'completed' : 'active'}`));
    } else {
        console.log('❌ Condition NOT met: wasCompleted=', wasCompleted, 'task.completed=', task.completed);
    }

    console.log('Calling renderTasks');
    renderTasks();
    console.log('Calling saveData');
    saveData();
    console.log('=== TOGGLE TASK END ===');
}

function focusTask(taskId) {
    console.log('focusTask called with taskId:', taskId);
    if (!currentTabId) {
        console.log('❌ No currentTabId, returning');
        return;
    }

    const task = tabs[currentTabId].tasks.find(t => t.id === taskId);
    console.log('Task found:', task ? task.id : 'null');
    if (task) {
        console.log('Entering focus mode for task:', task.text);
        enterFocusMode(task.text);
    } else {
        console.log('❌ Task not found');
    }
}

// Rendering functions
function renderTabs() {
    tabsContainer.innerHTML = '';

    Object.values(tabs).forEach(tab => {
        const tabElement = document.createElement('div');
        tabElement.className = `tab ${tab.id === currentTabId ? 'active' : ''}`;
        tabElement.dataset.tabId = tab.id;

        // Tab content
        const tabContent = document.createElement('span');
        tabContent.textContent = tab.name;
        tabElement.appendChild(tabContent);

        // Close button (only if more than one tab)
        if (Object.keys(tabs).length > 1) {
            const closeBtn = document.createElement('button');
            closeBtn.className = 'tab-close';
            closeBtn.textContent = '×';
            closeBtn.title = 'Close tab';
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeTab(tab.id);
            });
            tabElement.appendChild(closeBtn);
        }

        // Click to switch tabs or rename if already active
        tabElement.addEventListener('click', () => {
            if (tab.id === currentTabId) {
                // Active tab clicked - rename it
                showRenameModal(tab.id);
            } else {
                // Inactive tab clicked - switch to it
                switchToTab(tab.id);
            }
        });

        // Double-click to rename
        tabElement.addEventListener('dblclick', (e) => {
            if (e.target.className !== 'tab-close') {
                showRenameModal(tab.id);
            }
        });

        tabsContainer.appendChild(tabElement);
    });
}

function renderTasks() {
    if (!currentTabId) {
        tasksContainer.innerHTML = '<div style="text-align: center; color: #666; padding: 40px;">No tab selected</div>';
        doneContainer.style.display = 'none';
        return;
    }

    const currentTab = tabs[currentTabId];
    if (!currentTab.tasks.length) {
        tasksContainer.innerHTML = '<div style="text-align: center; color: #666; padding: 40px;">No tasks yet. Add one below!</div>';
        doneContainer.style.display = 'none';
        return;
    }

    // Separate completed and incomplete tasks
    const incompleteTasks = currentTab.tasks.filter(task => !task.completed);
    const completedTasks = currentTab.tasks.filter(task => task.completed);

    // Render incomplete tasks in main tasks container
    tasksContainer.innerHTML = '';
    if (incompleteTasks.length === 0) {
        tasksContainer.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">All tasks completed! 🎉</div>';
    } else {
        incompleteTasks.forEach(task => {
            const taskElement = createTaskElement(task);
            tasksContainer.appendChild(taskElement);
        });

        // Add invisible drag target at bottom
        const bottomDragTarget = document.createElement('div');
        bottomDragTarget.className = 'bottom-drag-target';
        bottomDragTarget.dataset.position = 'bottom';
        bottomDragTarget.addEventListener('dragover', handleBottomDragOver);
        bottomDragTarget.addEventListener('dragleave', handleBottomDragLeave);
        bottomDragTarget.addEventListener('drop', handleBottomDrop);
        tasksContainer.appendChild(bottomDragTarget);
    }

    // Render completed tasks in done container
    doneTasksContainer.innerHTML = '';
    if (completedTasks.length > 0) {
        completedTasks.forEach(task => {
            const taskElement = createTaskElement(task);
            doneTasksContainer.appendChild(taskElement);
        });

        // Add invisible drag target at bottom
        const doneBottomDragTarget = document.createElement('div');
        doneBottomDragTarget.className = 'bottom-drag-target';
        doneBottomDragTarget.dataset.position = 'bottom';
        doneBottomDragTarget.addEventListener('dragover', handleBottomDragOver);
        doneBottomDragTarget.addEventListener('dragleave', handleBottomDragLeave);
        doneBottomDragTarget.addEventListener('drop', handleBottomDrop);
        doneTasksContainer.appendChild(doneBottomDragTarget);

        doneContainer.style.display = 'block';
    } else {
        doneContainer.style.display = 'none';
    }
}

function createTaskElement(task) {
    const taskElement = document.createElement('div');
    taskElement.className = `task-item ${task.completed ? 'completed-task' : ''}`;
    taskElement.draggable = true;
    taskElement.dataset.taskId = task.id;

    // Build action buttons based on task completion status
    let actionButtons = '';
    if (!task.completed) {
        // Incomplete tasks get both focus and delete buttons
        actionButtons = `
            <button class="focus-btn" data-task-id="${task.id}" title="Focus on this task">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <circle cx="12" cy="12" r="6"/>
                    <circle cx="12" cy="12" r="2"/>
                </svg>
            </button>
            <button class="delete-btn" data-task-id="${task.id}">×</button>
        `;
    } else {
        // Completed tasks only get delete button
        actionButtons = `
            <button class="delete-btn" data-task-id="${task.id}">×</button>
        `;
    }

    taskElement.innerHTML = `
        <div class="drag-handle">⋮⋮</div>
        <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''} data-task-id="${task.id}">
        <span class="task-text ${task.completed ? 'completed' : ''}">${task.text}</span>
        <div class="task-actions">
            ${actionButtons}
        </div>
    `;

    // Prevent dragging when clicking on interactive elements
    const interactiveElements = taskElement.querySelectorAll('input, button');
    interactiveElements.forEach(el => {
        el.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
    });

    // Drag event listeners
    taskElement.addEventListener('dragstart', handleDragStart);
    taskElement.addEventListener('dragend', handleDragEnd);
    taskElement.addEventListener('dragover', handleDragOver);
    taskElement.addEventListener('drop', handleDrop);

    return taskElement;
}

// Event listeners
function setupEventListeners() {
    // Add tab button
    if (addTabBtn) {
        addTabBtn.addEventListener('click', () => {
            showTabNameModal();
        });
    }

    // Modal buttons
    if (cancelTabBtn) {
        cancelTabBtn.addEventListener('click', () => {
            hideTabNameModal();
        });
    }

    if (createTabBtn) {
        createTabBtn.addEventListener('click', () => {
            const tabName = tabNameInput.value.trim();

            if (renamingTabId) {
                // Renaming existing tab
                renameTab(renamingTabId, tabName);
            } else {
                // Creating new tab
                const newTabId = createNewTab(tabName);
                switchToTab(newTabId);
            }

            hideTabNameModal();
        });
    }

    // Close modal on Enter key
    if (tabNameInput) {
        tabNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                createTabBtn.click();
            }
        });
    }

    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !tabNameModal.classList.contains('hidden')) {
            hideTabNameModal();
        }
    });

    // Close modal when clicking outside
    if (tabNameModal) {
        tabNameModal.addEventListener('click', (e) => {
            if (e.target === tabNameModal) {
                hideTabNameModal();
            }
        });
    }

    // Task events for active tasks
    tasksContainer.addEventListener('click', (e) => {
        console.log('Click detected on:', e.target.tagName, e.target.className, 'dataset:', e.target.dataset);

        const taskId = e.target.dataset.taskId || e.target.closest('[data-task-id]')?.dataset.taskId;
        console.log('Resolved taskId:', taskId);

        if (!taskId) {
            console.log('No taskId found, ignoring click');
            return;
        }

        if (e.target.classList.contains('delete-btn') || e.target.closest('.delete-btn')) {
            console.log('Delete button clicked for task:', taskId);
            deleteTask(taskId);
        } else if (e.target.classList.contains('focus-btn') || e.target.closest('.focus-btn')) {
            console.log('Focus button clicked for task:', taskId, 'target:', e.target.tagName, e.target.className);
            focusTask(taskId);
        } else if (e.target.classList.contains('task-checkbox') || e.target.closest('.task-checkbox')) {
            console.log('Checkbox clicked for task:', taskId);
            toggleTask(taskId);
        }
    });

    // Task events for completed tasks (done section)
    doneTasksContainer.addEventListener('click', (e) => {
        const taskId = e.target.dataset.taskId;
        if (!taskId) return;

        if (e.target.classList.contains('delete-btn')) {
            deleteTask(taskId);
        } else if (e.target.classList.contains('task-checkbox')) {
            toggleTask(taskId);
        }
    });

    // Add task events
    addTaskBtn.addEventListener('click', () => {
        addTask(newTaskInput.value);
    });

    newTaskInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addTask(newTaskInput.value);
        }
    });

    newTaskInput.addEventListener('input', () => {
        addTaskBtn.disabled = !newTaskInput.value.trim();
    });

    // Focus mode events
    exitFocusBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        exitFocusMode();
    });

    // Custom drag implementation
    const focusContainer = document.querySelector('.focus-container');
    if (focusContainer) {
        let isDragging = false;
        let startX, startY;

        focusContainer.addEventListener('mousedown', (e) => {
            if (e.target.closest('.exit-focus-btn')) return; // Don't drag if clicking exit button
            
            isDragging = true;
            startX = e.screenX;
            startY = e.screenY;
            
            // Prevent text selection while dragging
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const deltaX = e.screenX - startX;
            const deltaY = e.screenY - startY;

            ipcRenderer.send('window-move', { x: deltaX, y: deltaY });

            startX = e.screenX;
            startY = e.screenY;
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    // Double-click to exit focus mode
    /* 
    document.addEventListener('dblclick', (e) => {
        if (isFocusMode) {
            e.preventDefault();
            e.stopPropagation();
            exitFocusMode();
        }
    });
    */
}

// Focus mode functions
function enterFocusMode(taskName) {
    console.log('enterFocusMode called with taskName:', taskName);
    isFocusMode = true;
    console.log('Hiding normal mode, showing focus mode');
    normalMode.classList.add('hidden');
    focusMode.classList.remove('hidden');

    focusTaskName.textContent = taskName;
    focusTaskName.title = taskName;

    console.log('Starting focus timer');
    startFocusTimer();

    // Calculate appropriate window width based on content
    setTimeout(() => {
        const container = document.querySelector('.focus-container');
        if (container) {
            const containerWidth = Math.min(Math.max(container.offsetWidth, 280), 500);
            console.log('Calculated container width:', containerWidth);
            ipcRenderer.send('set-focus-window-size', containerWidth);
        }
    }, 50); // Small delay to ensure DOM is updated

    console.log('Sending enter-focus-mode IPC');
    ipcRenderer.send('enter-focus-mode', taskName);
}

function exitFocusMode() {
    isFocusMode = false;
    stopFocusTimer();

    focusMode.classList.add('hidden');
    normalMode.classList.remove('hidden');

    ipcRenderer.send('exit-focus-mode');
}

function startFocusTimer() {
    focusStartTime = Date.now();

    focusTimerInterval = setInterval(updateFocusTimer, 1000);
}

function stopFocusTimer() {
    if (focusTimerInterval) {
        clearInterval(focusTimerInterval);
        focusTimerInterval = null;
    }
}

function updateFocusTimer() {
    if (!isFocusMode || !focusStartTime) return;

    const elapsed = Date.now() - focusStartTime;
    const hours = Math.floor(elapsed / (1000 * 60 * 60));
    const minutes = Math.floor((elapsed % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((elapsed % (1000 * 60)) / 1000);

    const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    focusTimer.textContent = timeString;
}

// Drag and drop functions
function handleDragStart(e) {
    draggedTaskId = e.target.dataset.taskId;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target.outerHTML);
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');
    draggedTaskId = null;

    // Remove drag over classes
    document.querySelectorAll('.task-item.drag-over, .bottom-drag-target.drag-over').forEach(el => {
        el.classList.remove('drag-over');
    });
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const target = e.target.closest('.task-item');

    // Clear all previous drag-over states
    document.querySelectorAll('.task-item.drag-over, .bottom-drag-target.drag-over').forEach(el => {
        el.classList.remove('drag-over');
    });

    if (target && target.dataset.taskId !== draggedTaskId) {
        // Dragging over a task item - show blue line above it
        target.classList.add('drag-over');
    }
}

function handleDrop(e) {
    e.preventDefault();

    const targetTask = e.target.closest('.task-item');

    if (!draggedTaskId) return;

    if (targetTask && targetTask.dataset.taskId !== draggedTaskId) {
        // Dropped on a task - reorder relative to that task
        reorderTasks(draggedTaskId, targetTask.dataset.taskId);
    }
    // Bottom drops are handled by the bottom drag targets
}

// Task reordering function
function reorderTasks(draggedId, targetId) {
    if (!currentTabId) return;

    const currentTab = tabs[currentTabId];
    const draggedIndex = currentTab.tasks.findIndex(task => task.id === draggedId);
    const targetIndex = currentTab.tasks.findIndex(task => task.id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    // Remove dragged task
    const [draggedTask] = currentTab.tasks.splice(draggedIndex, 1);

    // Calculate insert position
    let insertIndex = targetIndex;

    // If we removed an item before the target, adjust the index
    if (draggedIndex < targetIndex) {
        insertIndex = targetIndex - 1;
    }

    currentTab.tasks.splice(insertIndex, 0, draggedTask);

    // Save and re-render
    saveData();
    renderTasks();
}

// Bottom drag handlers
function handleBottomDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // Clear all drag-over states
    document.querySelectorAll('.task-item.drag-over, .bottom-drag-target.drag-over').forEach(el => {
        el.classList.remove('drag-over');
    });

    // Add drag-over to this bottom target
    e.target.classList.add('drag-over');
}

function handleBottomDragLeave(e) {
    e.target.classList.remove('drag-over');
}

function handleBottomDrop(e) {
    e.preventDefault();
    e.target.classList.remove('drag-over');

    if (draggedTaskId) {
        moveTaskToBottom(draggedTaskId);
    }
}

// Move task to bottom function
function moveTaskToBottom(taskId) {
    if (!currentTabId) return;

    const currentTab = tabs[currentTabId];
    const taskIndex = currentTab.tasks.findIndex(task => task.id === taskId);

    if (taskIndex === -1) return;

    // Remove task and add to end
    const [task] = currentTab.tasks.splice(taskIndex, 1);
    currentTab.tasks.push(task);

    // Save and re-render
    saveData();
    renderTasks();
}

// Modal functions
function showTabNameModal() {
    renamingTabId = null;
    modalTitle.textContent = 'Enter list name';
    createTabBtn.textContent = 'Create';
    tabNameInput.value = '';
    tabNameModal.classList.remove('hidden');
    tabNameInput.focus();
}

function showRenameModal(tabId) {
    renamingTabId = tabId;
    const tab = tabs[tabId];
    if (tab) {
        modalTitle.textContent = 'Rename tab';
        createTabBtn.textContent = 'Rename';
        tabNameInput.value = tab.name;
        tabNameModal.classList.remove('hidden');
        tabNameInput.focus();
        tabNameInput.select(); // Select all text for easy replacement
    }
}

function hideTabNameModal() {
    tabNameModal.classList.add('hidden');
    tabNameInput.value = '';
    renamingTabId = null;
}

// IPC listeners
ipcRenderer.on('enter-focus-mode', (event, taskName) => {
    enterFocusMode(taskName);
});

ipcRenderer.on('exit-focus-mode', () => {
    exitFocusMode();
});

// Data persistence
function saveData() {
    const data = {
        tabs: tabs,
        currentTabId: currentTabId,
        taskCounter: taskCounter
    };
    localStorage.setItem('redd-task-data', JSON.stringify(data));
}

function loadData() {
    try {
        const data = JSON.parse(localStorage.getItem('redd-task-data'));
        if (data) {
            tabs = data.tabs || {};
            currentTabId = data.currentTabId || null;
            taskCounter = data.taskCounter || 0;
        }
    } catch (e) {
        console.error('Failed to load data:', e);
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', initApp);
