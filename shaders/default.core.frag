#version 330
/****************************************************************************
**
** Copyright (C) 2017 Klaralvdalens Datakonsult AB (KDAB).
** Contact: https://www.qt.io/licensing/
**
** This file is part of the Qt3D module of the Qt Toolkit.
**
** $QT_BEGIN_LICENSE:BSD$
** Commercial License Usage
** Licensees holding valid commercial Qt licenses may use this file in
** accordance with the commercial license agreement provided with the
** Software or, alternatively, in accordance with the terms contained in
** a written agreement between you and The Qt Company. For licensing terms
** and conditions see https://www.qt.io/terms-conditions. For further
** information use the contact form at https://www.qt.io/contact-us.
**
** BSD License Usage
** Alternatively, you may use this file under the terms of the BSD license
** as follows:
**
** "Redistribution and use in source and binary forms, with or without
** modification, are permitted provided that the following conditions are
** met:
**   * Redistributions of source code must retain the above copyright
**     notice, this list of conditions and the following disclaimer.
**   * Redistributions in binary form must reproduce the above copyright
**     notice, this list of conditions and the following disclaimer in
**     the documentation and/or other materials provided with the
**     distribution.
**   * Neither the name of The Qt Company Ltd nor the names of its
**     contributors may be used to endorse or promote products derived
**     from this software without specific prior written permission.
**
**
** THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
** "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
** LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
** A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
** OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
** SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
** LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
** DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
** THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
** (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
** OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE."
**
** $QT_END_LICENSE$
**
****************************************************************************/

// Please note that, this file "pbr.frag" is copied and slightly modified from the Qt3D's pbr shader "metalrough.inc.frag"
// https://github.com/qt/qt3d/blob/5.11/src/extras/shaders/gl3/metalrough.inc.frag

// Exposure correction
highp float exposure;
// Gamma correction
highp float gamma;

in highp vec3 vert;
in highp vec3 vertRaw;
in highp vec3 vertNormal;
in highp vec3 vertColor;
in highp vec2 vertTexCoord;
in highp float vertMetalness;
in highp float vertRoughness;
in highp vec3 cameraPos;
in highp vec3 firstLightPos;
in highp vec3 secondLightPos;
in highp vec3 thirdLightPos;
in highp float vertAlpha;
out highp vec4 fragColor;
uniform highp vec3 lightPos;
uniform highp sampler2D textureId;
uniform highp int textureEnabled;
uniform highp sampler2D normalMapId;
uniform highp int normalMapEnabled;
uniform highp sampler2D metalnessRoughnessAmbientOcclusionMapId;
uniform highp int metalnessMapEnabled;
uniform highp int roughnessMapEnabled;
uniform highp int ambientOcclusionMapEnabled;
uniform highp int mousePickEnabled;
uniform highp vec3 mousePickTargetPosition;
uniform highp float mousePickRadius;

const int MAX_LIGHTS = 8;
const int TYPE_POINT = 0;
const int TYPE_DIRECTIONAL = 1;
const int TYPE_SPOT = 2;
struct Light {
    int type;
    highp vec3 position;
    highp vec3 color;
    highp float intensity;
    highp vec3 direction;
    highp float constantAttenuation;
    highp float linearAttenuation;
    highp float quadraticAttenuation;
    highp float cutOffAngle;
};
int lightCount;
Light lights[MAX_LIGHTS];

highp float remapRoughness(const in highp float roughness)
{
    // As per page 14 of
    // http://www.frostbite.com/wp-content/uploads/2014/11/course_notes_moving_frostbite_to_pbr.pdf
    // we remap the roughness to give a more perceptually linear response
    // of "bluriness" as a function of the roughness specified by the user.
    // r = roughness^2
    highp float maxSpecPower;
    highp float minRoughness;
    maxSpecPower = 999999.0;
    minRoughness = sqrt(2.0 / (maxSpecPower + 2.0));
    return max(roughness * roughness, minRoughness);
}

highp float normalDistribution(const in highp vec3 n, const in highp vec3 h, const in highp float alpha)
{
    // Blinn-Phong approximation - see
    // http://graphicrants.blogspot.co.uk/2013/08/specular-brdf-reference.html
    highp float specPower = 2.0 / (alpha * alpha) - 2.0;
    return (specPower + 2.0) / (2.0 * 3.14159) * pow(max(dot(n, h), 0.0), specPower);
}

highp vec3 fresnelFactor(const in highp vec3 color, const in highp float cosineFactor)
{
    // Calculate the Fresnel effect value
    highp vec3 f = color;
    highp vec3 F = f + (1.0 - f) * pow(1.0 - cosineFactor, 5.0);
    return clamp(F, f, vec3(1.0));
}

highp float geometricModel(const in highp float lDotN,
                     const in highp float vDotN,
                     const in highp vec3 h)
{
    // Implicit geometric model (equal to denominator in specular model).
    // This currently assumes that there is no attenuation by geometric shadowing or
    // masking according to the microfacet theory.
    return lDotN * vDotN;
}

highp vec3 specularModel(const in highp vec3 F0,
                   const in highp float sDotH,
                   const in highp float sDotN,
                   const in highp float vDotN,
                   const in highp vec3 n,
                   const in highp vec3 h)
{
    // Clamp sDotN and vDotN to small positive value to prevent the
    // denominator in the reflection equation going to infinity. Balance this
    // by using the clamped values in the geometric factor function to
    // avoid ugly seams in the specular lighting.
    highp float sDotNPrime = max(sDotN, 0.001);
    highp float vDotNPrime = max(vDotN, 0.001);

    highp vec3 F = fresnelFactor(F0, sDotH);
    highp float G = geometricModel(sDotNPrime, vDotNPrime, h);

    highp vec3 cSpec = F * G / (4.0 * sDotNPrime * vDotNPrime);
    return clamp(cSpec, vec3(0.0), vec3(1.0));
}

highp vec3 pbrModel(const in int lightIndex,
              const in highp vec3 wPosition,
              const in highp vec3 wNormal,
              const in highp vec3 wView,
              const in highp vec3 baseColor,
              const in highp float metalness,
              const in highp float alpha,
              const in highp float ambientOcclusion)
{
    // Calculate some useful quantities
    highp vec3 n = wNormal;
    highp vec3 s = vec3(0.0);
    highp vec3 v = wView;
    highp vec3 h = vec3(0.0);

    highp float vDotN = dot(v, n);
    highp float sDotN = 0.0;
    highp float sDotH = 0.0;
    highp float att = 1.0;

    if (lights[lightIndex].type != TYPE_DIRECTIONAL) {
        // Point and Spot lights
        highp vec3 sUnnormalized = vec3(lights[lightIndex].position) - wPosition;
        s = normalize(sUnnormalized);

        // Calculate the attenuation factor
        sDotN = dot(s, n);
        if (sDotN > 0.0) {
            if (lights[lightIndex].constantAttenuation != 0.0
             || lights[lightIndex].linearAttenuation != 0.0
             || lights[lightIndex].quadraticAttenuation != 0.0) {
                highp float dist = length(sUnnormalized);
                att = 1.0 / (lights[lightIndex].constantAttenuation +
                             lights[lightIndex].linearAttenuation * dist +
                             lights[lightIndex].quadraticAttenuation * dist * dist);
            }

            // The light direction is in world space already
            if (lights[lightIndex].type == TYPE_SPOT) {
                // Check if fragment is inside or outside of the spot light cone
                if (degrees(acos(dot(-s, lights[lightIndex].direction))) > lights[lightIndex].cutOffAngle)
                    sDotN = 0.0;
            }
        }
    } else {
        // Directional lights
        // The light direction is in world space already
        s = normalize(-lights[lightIndex].direction);
        sDotN = dot(s, n);
    }

    h = normalize(s + v);
    sDotH = dot(s, h);

    // Calculate diffuse component
    highp vec3 diffuseColor = (1.0 - metalness) * baseColor * lights[lightIndex].color;
    highp vec3 diffuse = diffuseColor * max(sDotN, 0.0) / 3.14159;

    // Calculate specular component
    highp vec3 dielectricColor = vec3(0.04);
    highp vec3 F0 = mix(dielectricColor, baseColor, metalness);
    highp vec3 specularFactor = vec3(0.0);
    if (sDotN > 0.0) {
        specularFactor = specularModel(F0, sDotH, sDotN, vDotN, n, h);
        specularFactor *= normalDistribution(n, h, alpha);
    }
    highp vec3 specularColor = lights[lightIndex].color;
    highp vec3 specular = specularColor * specularFactor;

    // Blend between diffuse and specular to conserver energy
    highp vec3 color = att * lights[lightIndex].intensity * (specular + diffuse * (vec3(1.0) - specular));

    // Reduce by ambient occlusion amount
    color *= ambientOcclusion;

    return color;
}

highp vec3 toneMap(const in highp vec3 c)
{
    return c / (c + vec3(1.0));
}

highp vec3 gammaCorrect(const in highp vec3 color)
{
    return pow(color, vec3(1.0 / gamma));
}

highp vec4 metalRoughFunction(const in highp vec4 baseColor,
                        const in highp float metalness,
                        const in highp float roughness,
                        const in highp float ambientOcclusion,
                        const in highp vec3 worldPosition,
                        const in highp vec3 worldView,
                        const in highp vec3 worldNormal)
{
    highp vec3 cLinear = vec3(0.0);

    // Remap roughness for a perceptually more linear correspondence
    highp float alpha = remapRoughness(roughness);

    for (int i = 0; i < lightCount; ++i) {
        cLinear += pbrModel(i,
                            worldPosition,
                            worldNormal,
                            worldView,
                            baseColor.rgb,
                            metalness,
                            alpha,
                            ambientOcclusion);
    }

    // Apply exposure correction
    cLinear *= pow(2.0, exposure);

    // Apply simple (Reinhard) tonemap transform to get into LDR range [0, 1]
    highp vec3 cToneMapped = toneMap(cLinear);

    // Apply gamma correction prior to display
    highp vec3 cGamma = gammaCorrect(cToneMapped);

    return vec4(cGamma, baseColor.a);
}

void main() 
{
    // FIXME: don't hard code here
    exposure = 1.0;
    gamma = 2.2;

    // Light settings:
    // https://doc-snapshots.qt.io/qt5-5.12/qt3d-pbr-materials-lights-qml.html
    lightCount = 3;

    // Key light 
    lights[0].type = TYPE_POINT;
    lights[0].position = firstLightPos;
    lights[0].color = vec3(1.0, 1.0, 1.0);
    lights[0].intensity = 3.0;
    lights[0].constantAttenuation = 0.0;
    lights[0].linearAttenuation = 0.0;
    lights[0].quadraticAttenuation = 0.0;

    // Fill light
    lights[1].type = TYPE_POINT;
    lights[1].position = secondLightPos;
    lights[1].color = vec3(1.0, 1.0, 1.0);
    lights[1].intensity = 1.0;
    lights[1].constantAttenuation = 0.0;
    lights[1].linearAttenuation = 0.0;
    lights[1].quadraticAttenuation = 0.0;

    // Rim light
    lights[2].type = TYPE_POINT;
    lights[2].position = thirdLightPos;
    lights[2].color = vec3(1.0, 1.0, 1.0);
    lights[2].intensity = 0.5;
    lights[2].constantAttenuation = 0.0;
    lights[2].linearAttenuation = 0.0;
    lights[2].quadraticAttenuation = 0.0;

    highp vec3 color = vertColor;
    highp float alpha = vertAlpha;
    if (textureEnabled == 1) {
        highp vec4 textColor = texture(textureId, vertTexCoord);
        color = textColor.rgb;
        alpha = textColor.a;
    }
    if (mousePickEnabled == 1) {
        if (distance(mousePickTargetPosition, vertRaw) <= mousePickRadius) {
            color = color + vec3(0.99, 0.4, 0.13);
        }
    }
    color = pow(color, vec3(gamma));

    highp vec3 normal = vertNormal;
    if (normalMapEnabled == 1) {
        normal = texture(normalMapId, vertTexCoord).rgb;
        normal = normalize(normal * 2.0 - 1.0);
    }

    // Red: Ambient Occlusion
    // Green: Roughness
    // Blue: Metallic

    highp float metalness = vertMetalness;
    if (metalnessMapEnabled == 1) {
        metalness = texture(metalnessRoughnessAmbientOcclusionMapId, vertTexCoord).b;
    }

    highp float roughness = vertRoughness;
    if (roughnessMapEnabled == 1) {
        roughness = texture(metalnessRoughnessAmbientOcclusionMapId, vertTexCoord).g;
    }

    highp float ambientOcclusion = 1.0;
    if (ambientOcclusionMapEnabled == 1) {
        ambientOcclusion = texture(metalnessRoughnessAmbientOcclusionMapId, vertTexCoord).r;
    }
    
    roughness = min(0.99, roughness);
    metalness = min(0.99, metalness);

    fragColor = metalRoughFunction(vec4(color, alpha),
                                      metalness,
                                      roughness,
                                      ambientOcclusion,
                                      vert,
                                      normalize(cameraPos - vert),
                                      normal);
}
