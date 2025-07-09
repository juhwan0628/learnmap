import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-functions.js';

document.addEventListener('DOMContentLoaded', async () => {
    // --- Firebase 초기화 (자동 구성) ---
    async function initializeFirebase() {
        const response = await fetch('/__/firebase/init.json');
        const firebaseConfig = await response.json();
        const app = initializeApp(firebaseConfig);
        return getFunctions(app);
    }

    const functions = await initializeFirebase();

    // --- DOM Elements ---
    const roadmapForm = document.getElementById('roadmap-form');
    const goalInputSection = document.getElementById('goal-input-section');
    const loadingIndicator = document.getElementById('loading-indicator');
    const roadmapSection = document.getElementById('roadmap-section');
    const roadmapTitle = document.getElementById('roadmap-title');
    const mindmapContainer = document.getElementById('mindmap-container');
    const mindmapCanvas = document.getElementById('mindmap-canvas'); // The new draggable canvas
    const resourcesSidebar = document.getElementById('learning-resources-sidebar');
    const resourceTitle = document.getElementById('resource-title');
    const resourcesList = document.getElementById('resources-list');
    const newRoadmapBtn = document.getElementById('new-roadmap-btn');
    const errorMessage = document.getElementById('error-message');

    // --- Popular Learning Goals Button Logic ---
    const popularGoalButtons = document.querySelectorAll('.popular-goal-btn');
    const learningGoalInput = document.getElementById('learning-goal-input'); // Get the input element

    popularGoalButtons.forEach(button => {
        button.addEventListener('click', () => {
            learningGoalInput.value = button.textContent; // Set input value
            roadmapForm.dispatchEvent(new Event('submit')); // Trigger form submission
        });
    });

    // --- Panning Logic ---
    let isDragging = false;
    let startX, startY;
    let translateX = 0, translateY = 0;

    mindmapContainer.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.pageX - translateX;
        startY = e.pageY - translateY;
        mindmapContainer.style.cursor = 'grabbing';
        // Prevent text selection while dragging
        e.preventDefault();
    });

    mindmapContainer.addEventListener('mouseleave', () => {
        isDragging = false;
        mindmapContainer.style.cursor = 'grab';
    });

    mindmapContainer.addEventListener('mouseup', () => {
        isDragging = false;
        mindmapContainer.style.cursor = 'grab';
    });

    mindmapContainer.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        translateX = e.pageX - startX;
        translateY = e.pageY - startY;
        mindmapCanvas.style.transform = `translate(${translateX}px, ${translateY}px)`;
    });


    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
    }

    function clearError() {
        errorMessage.classList.add('hidden');
    }

    // --- 로드맵 생성 이벤트 리스너 ---
    roadmapForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const learningGoal = document.getElementById('learning-goal-input').value;
        
        if (!learningGoal) return;

        goalInputSection.classList.add('hidden');
        loadingIndicator.classList.remove('hidden');
        roadmapSection.classList.add('hidden');
        resourcesSidebar.classList.add('hidden');
        clearError();

        try {
            const generateRoadmap = httpsCallable(functions, 'generateRoadmap');
            const result = await generateRoadmap({ topic: learningGoal });
            console.log("Roadmap data from function:", result.data);
            displayRoadmap(result.data);
        } catch (error) {
            console.error("Error generating roadmap:", error);
            const userMessage = error.message || '알 수 없는 오류가 발생했습니다.';
            showError(`로드맵 생성에 실패했습니다: ${userMessage}`);
            goalInputSection.classList.remove('hidden');
        } finally {
            loadingIndicator.classList.add('hidden');
            roadmapSection.classList.remove('hidden');
        }
    });

    // --- 새 로드맵 생성 버튼 이벤트 리스너 ---
    newRoadmapBtn.addEventListener('click', () => {
        goalInputSection.classList.remove('hidden');
        roadmapSection.classList.add('hidden');
        resourcesSidebar.classList.add('hidden');
        document.getElementById('learning-goal-input').value = '';
        clearError();
        // Reset pan
        translateX = 0;
        translateY = 0;
        mindmapCanvas.style.transform = 'translate(0, 0)';
    });


    // --- 로드맵 표시 함수 ---
    function displayRoadmap(roadmap) {
        if (!roadmap || !roadmap.title || !roadmap.nodes) {
            console.error('Invalid roadmap data received:', roadmap);
            showError('잘못된 로드맵 데이터 형식입니다.');
            goalInputSection.classList.remove('hidden');
            roadmapSection.classList.add('hidden');
            return;
        }
        roadmapTitle.textContent = roadmap.title;
        mindmapCanvas.innerHTML = ''; // Clear the canvas, not the container

        const positions = calculateNodePositions(roadmap.nodes);

        // Lines are drawn first, so they appear underneath the nodes.
        const svg = createLineElements(roadmap.nodes, positions);
        mindmapCanvas.appendChild(svg);

        // Nodes are drawn second, appearing on top of lines due to z-index and DOM order.
        roadmap.nodes.forEach(nodeData => {
            const nodeEl = createNodeElement(nodeData, positions[nodeData.id]);
            mindmapCanvas.appendChild(nodeEl);
        });
    }
    
    // --- 노드 클릭 처리 함수 ---
    async function handleNodeClick(nodeData) {
        console.log("Node clicked:", nodeData);
        resourceTitle.textContent = `${nodeData.label} - 학습 자료`;
        resourcesList.innerHTML = '<p>AI가 추천 자료를 찾고 있습니다...</p>';
        resourcesSidebar.classList.remove('hidden');

        try {
            const getLearningResources = httpsCallable(functions, 'getLearningResources');
            const result = await getLearningResources({ nodeLabel: nodeData.label });
            displayResources(result.data.resources);
        } catch (error) {
            console.error("Error fetching resources:", error);
            const userMessage = error.message || '알 수 없는 오류가 발생했습니다.';
            resourcesList.innerHTML = `<p>자료를 불러오는 데 실패했습니다: ${userMessage}</p>`;
        }
    }

    // --- Function to Display Resources ---
    function displayResources(resources) {
        resourcesList.innerHTML = '';
        if (!resources || resources.length === 0) {
            resourcesList.innerHTML = '<p>추천 자료를 찾지 못했습니다.</p>';
            return;
        }

        resources.forEach(resource => {
            const resourceItem = document.createElement('a');
            resourceItem.href = resource.url;
            resourceItem.target = '_blank';
            resourceItem.className = 'block p-4 rounded-md border border-slate-200 bg-white hover:border-[var(--primary-color)] hover:shadow-md transition-all duration-300';
            const typeText = resource.type === 'video' ? '📺 영상' : '📄 아티클';
            resourceItem.innerHTML = `
                <p class="text-sm text-slate-500 mb-1">${typeText}</p>
                <h4 class="text-md font-semibold text-slate-800">${resource.title}</h4>
            `;
            resourcesList.appendChild(resourceItem);
        });
    }

    // --- Helper Functions for Mindmap Layout ---
    function createNodeElement(nodeData, pos) {
        const nodeEl = document.createElement('div');
        nodeEl.id = nodeData.id;
        nodeEl.textContent = nodeData.label;
        nodeEl.className = 'node';
        if (nodeData.isCentral) nodeEl.classList.add('central');
        nodeEl.style.top = pos.y + 'px';
        nodeEl.style.left = pos.x + 'px';
        nodeEl.style.transform = 'translate(-50%, -50%)';
        nodeEl.addEventListener('click', () => handleNodeClick(nodeData));
        return nodeEl;
    }

    function createLineElements(nodes, positions) {
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, 'svg');
        // The SVG needs to be large enough to contain all lines even when panned.
        // A fixed large size or dynamic sizing can work. Let's use a large fixed size for simplicity.
        svg.setAttribute('class', 'absolute');
        svg.style.width = '2000px';
        svg.style.height = '2000px';
        svg.style.top = '-500px'; // Offset to keep the center aligned
        svg.style.left = '-500px';
        svg.style.pointerEvents = 'none';

        nodes.filter(n => n.parent).forEach(node => {
            const childPos = positions[node.id];
            const parentPos = positions[node.parent];
            if (!childPos || !parentPos) return;

            const line = document.createElementNS(svgNS, 'line');
            // Adjust line coordinates for the oversized SVG container
            line.setAttribute('x1', parentPos.x + 500);
            line.setAttribute('y1', parentPos.y + 500);
            line.setAttribute('x2', childPos.x + 500);
            line.setAttribute('y2', childPos.y + 500);
            line.setAttribute('stroke', '#94a3b8');
            line.setAttribute('stroke-width', '2');
            svg.appendChild(line);
        });
        return svg;
    }

    function calculateNodePositions(nodes) {
        const positions = {};
        // Calculate positions based on the visible container, not the oversized canvas
        const container = mindmapContainer;
        
        const width = container.offsetWidth || 600;
        const height = container.offsetHeight || 600;
        const centerX = width / 2;
        const centerY = height / 2;

        const centerNode = nodes.find(n => n.isCentral);
        if (centerNode) {
            positions[centerNode.id] = { x: centerX, y: centerY };
        }

        const childrenOf = (parentId) => nodes.filter(n => n.parent === parentId);
        const mainNodes = childrenOf(centerNode?.id);
        
        if (!mainNodes.length) return positions;

        const angleStep = (2 * Math.PI) / mainNodes.length;
        const mainRadius = Math.min(width, height) / 3.5;

        mainNodes.forEach((node, i) => {
            const angle = i * angleStep;
            positions[node.id] = {
                x: centerX + mainRadius * Math.cos(angle),
                y: centerY + mainRadius * Math.sin(angle)
            };

            const subNodes = childrenOf(node.id);
            if (!subNodes.length) return;
            
            const subRadius = mainRadius + 180;
            const subAngleSpread = angleStep * 0.8;
            const subAngleStep = subNodes.length > 1 ? subAngleSpread / (subNodes.length - 1) : 0;
            const startAngle = angle - (subAngleSpread / 2);

            subNodes.forEach((subNode, j) => {
                const subAngle = subNodes.length > 1 ? startAngle + (subAngleStep * j) : angle;
                positions[subNode.id] = {
                    x: centerX + subRadius * Math.cos(subAngle),
                    y: centerY + subRadius * Math.sin(subAngle)
                };
            });
        });

        return positions;
    }
});